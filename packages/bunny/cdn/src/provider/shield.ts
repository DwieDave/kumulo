import { Effect, Option, Ref, Schema } from "effect"
import { CapabilityMissing, ResourceConflict } from "@kumulo/core"
import type {
  AccessList,
  AccessListAction,
  AccessListType,
  CdnError,
  EdgeRef,
  RateLimitRule,
  SecurityPolicy,
  Sensitivity,
  ShieldPlan
} from "@kumulo/core"
import {
  BunnyRateLimitBlockTime,
  BunnyRateLimitTimeframe
} from "@kumulo/bunny"
import type {
  BunnyAccessListType,
  BunnyBotDetection,
  BunnyRateLimitConfiguration,
  BunnyShieldClient,
  BunnyShieldPlan,
  BunnyShieldZone,
  BunnyShieldZoneSettings
} from "@kumulo/bunny"
import { emptyCdnOutputs } from "../outputs.ts"
import type { CdnOutputsFile } from "../outputs.ts"

export interface BunnyShieldOptions {
  readonly shield: BunnyShieldClient
  readonly outputs?: Ref.Ref<CdnOutputsFile>
}

const _region = "bunny.net"

const _plans: Readonly<Record<ShieldPlan, BunnyShieldPlan>> = {
  basic: "Basic",
  advanced: "Advanced",
  business: "Business",
  enterprise: "Enterprise"
}

const _planOrder: ReadonlyArray<ShieldPlan> = ["basic", "advanced", "business", "enterprise"]

const _ddos = { off: "Off", low: "Low", medium: "Medium", high: "High" } as const satisfies Readonly<Record<Sensitivity, string>>

const _listTypes: Readonly<Record<AccessListType, BunnyAccessListType>> = {
  ip: "IP",
  cidr: "CIDR",
  asn: "ASN",
  country: "Country"
}

const _listActions: Readonly<Record<AccessListAction, "Allow" | "Block" | "Challenge" | "Log">> = {
  allow: "Allow",
  block: "Block",
  challenge: "Challenge",
  log: "Log"
}

const _pathVariable = "REQUEST_URI"

const _beginsWith = 0

const _rateLimitAction = 1

const _seconds = (value: string): number => Number(value.endsWith("s") ? value.slice(0, -1) : value)

const _nextPlan = (plan: ShieldPlan): ShieldPlan => _planOrder[_planOrder.indexOf(plan) + 1] ?? plan

const _missing = ({ capability, workaround }: { readonly capability: string; readonly workaround: string }) =>
  new CapabilityMissing({ capability, region: _region, workaround })

const _normalize = (entries: ReadonlyArray<string>): ReadonlyArray<string> =>
  [...new Set(entries.flatMap((entry) => (entry.trim() === "" ? [] : [entry.trim()])))].toSorted()

const _content = (entries: ReadonlyArray<string>): string => _normalize(entries).join("\n")

const _sameEntries = ({ left, right }: { readonly left: ReadonlyArray<string>; readonly right: ReadonlyArray<string> }): boolean =>
  _content(left) === _content(right)

const _desiredZone = (policy: SecurityPolicy): BunnyShieldZoneSettings => ({
  planType: _plans[policy.plan],
  wafEnabled: policy.waf?.enabled ?? false,
  wafExecutionMode: (policy.waf?.mode ?? "log") === "block" ? "Block" : "Log",
  dDoSShieldSensitivity: _ddos[policy.ddos?.sensitivity ?? "off"],
  learningMode: false
})

const _zoneDrifted = ({ desired, zone }: { readonly zone: BunnyShieldZone; readonly desired: BunnyShieldZoneSettings }): boolean =>
  zone.planType !== desired.planType
  || (zone.wafEnabled ?? false) !== desired.wafEnabled
  || zone.wafExecutionMode !== desired.wafExecutionMode
  || zone.dDoSShieldSensitivity !== desired.dDoSShieldSensitivity
  || zone.learningMode === true

const _rateConfig = (rule: RateLimitRule): Effect.Effect<BunnyRateLimitConfiguration, CapabilityMissing> =>
  Effect.gen(function*() {
    if (rule.key !== "ip") {
      return yield* Effect.fail(
        _missing({ capability: "shield.rate_limits.key", workaround: `rate limit ${rule.name}: only key "ip" is supported` })
      )
    }

    const window = Schema.decodeUnknownOption(BunnyRateLimitTimeframe)(_seconds(rule.window))
    const blockFor = Schema.decodeUnknownOption(BunnyRateLimitBlockTime)(_seconds(rule.blockFor))

    if (Option.isNone(window)) {
      return yield* Effect.fail(
        _missing({ capability: "shield.rate_limits.window", workaround: `rate limit ${rule.name}: window must be one of 1, 10, 60, 300, 900, 3600 seconds` })
      )
    }

    if (Option.isNone(blockFor)) {
      return yield* Effect.fail(
        _missing({ capability: "shield.rate_limits.block_for", workaround: `rate limit ${rule.name}: block_for must be one of 30, 60, 300, 900, 1800, 3600 seconds` })
      )
    }

    return {
      actionType: _rateLimitAction,
      counterKeyType: "IP",
      variableTypes: { [_pathVariable]: "" },
      operatorType: _beginsWith,
      value: rule.pathPrefix,
      isNegated: false,
      isRegexVariable: false,
      requestCount: rule.requests,
      timeframe: window.value,
      blockTime: blockFor.value
    }
  })

const _sameRule = ({ current, desired }: { readonly current: BunnyRateLimitConfiguration; readonly desired: BunnyRateLimitConfiguration }): boolean =>
  current.actionType === desired.actionType
  && current.counterKeyType === desired.counterKeyType
  && current.operatorType === desired.operatorType
  && (current.value ?? "") === (desired.value ?? "")
  && current.requestCount === desired.requestCount
  && current.timeframe === desired.timeframe
  && current.blockTime === desired.blockTime
  && current.variableTypes?.[_pathVariable] !== undefined

const _gate = ({ policy, zone }: { readonly policy: SecurityPolicy; readonly zone: BunnyShieldZone }): Effect.Effect<void, CapabilityMissing> =>
  policy.rateLimits.length > zone.rateLimitRulesLimit
    ? Effect.fail(
      _missing({
        capability: "shield.rate_limits",
        workaround: `${policy.rateLimits.length} rate limits configured but the ${policy.plan} plan allows ${zone.rateLimitRulesLimit}; use the ${_nextPlan(policy.plan)} plan or higher`
      })
    )
    : Effect.void

const _gateLists = (
  { limits, policy }: {
    readonly policy: SecurityPolicy
    readonly limits: { readonly customListLimit: number | undefined; readonly customEntryLimit: number | undefined }
  }
): Effect.Effect<void, CapabilityMissing> => {
  const entries = policy.accessLists.reduce((sum, list) => sum + _normalize(list.entries).length, 0)

  if (limits.customListLimit !== undefined && policy.accessLists.length > limits.customListLimit) {
    return Effect.fail(
      _missing({
        capability: "shield.access_lists",
        workaround: `${policy.accessLists.length} access lists configured but the ${policy.plan} plan allows ${limits.customListLimit}; use the ${_nextPlan(policy.plan)} plan or higher`
      })
    )
  }

  if (limits.customEntryLimit !== undefined && entries > limits.customEntryLimit) {
    return Effect.fail(
      _missing({
        capability: "shield.access_lists.entries",
        workaround: `${entries} access list entries configured but the ${policy.plan} plan allows ${limits.customEntryLimit}; use the ${_nextPlan(policy.plan)} plan or higher`
      })
    )
  }

  return Effect.void
}

const _botSensitivity = (sensitivity: Sensitivity) => _ddos[sensitivity]

const _botDrifted = ({ current, policy }: { readonly current: BunnyBotDetection; readonly policy: SecurityPolicy }): boolean => {
  const bot = policy.botDetection

  if (bot === undefined) return false

  const sensitivity = _botSensitivity(bot.sensitivity)

  return current.executionMode !== (bot.mode === "block" ? "Challenge" : "LogOnly")
    || current.requestIntegrity.sensitivity !== sensitivity
    || current.ipAddress.sensitivity !== sensitivity
    || current.browserFingerprint.sensitivity !== sensitivity
}

export type BunnyShield = ReturnType<typeof makeBunnyShield>

export const makeBunnyShield = (options: BunnyShieldOptions) => {
  const client = options.shield
  const outputs = options.outputs ?? Ref.makeUnsafe(emptyCdnOutputs("bunny"))

  const _ownedRules = Effect.map(Ref.get(outputs), (file) => file.rules)

  const _ownedLists = Effect.map(Ref.get(outputs), (file) => file.lists)

  const _obtainZone = ({ pullZoneId, settings }: { readonly pullZoneId: number; readonly settings: BunnyShieldZoneSettings }) =>
    client.getShieldZoneByPullZone(pullZoneId).pipe(
      Effect.flatMap(Option.match({
        onNone: () => client.createShieldZone({ pullZoneId, settings }),
        onSome: Effect.succeed
      }))
    )

  const _convergeZone = (
    { policy, pullZoneId }: { readonly pullZoneId: number; readonly policy: SecurityPolicy }
  ): Effect.Effect<BunnyShieldZone, CdnError> =>
    Effect.gen(function*() {
      const desired = _desiredZone(policy)
      const zone = yield* _obtainZone({ pullZoneId, settings: desired })

      return _zoneDrifted({ zone, desired })
        ? yield* client.patchShieldZone({ shieldZoneId: zone.shieldZoneId, settings: desired })
        : zone
    })

  const _convergeBot = ({ policy, shieldZoneId }: { readonly shieldZoneId: number; readonly policy: SecurityPolicy }): Effect.Effect<void, CdnError> => {
    const bot = policy.botDetection

    if (bot === undefined) return Effect.void

    const sensitivity = _botSensitivity(bot.sensitivity)

    return Effect.gen(function*() {
      const current = yield* client.getBotDetection(shieldZoneId)

      if (!_botDrifted({ current, policy })) return

      yield* client.updateBotDetection({
        shieldZoneId,
        executionMode: bot.mode === "block" ? "Challenge" : "LogOnly",
        requestIntegrity: { sensitivity },
        ipAddress: { sensitivity },
        browserFingerprint: { sensitivity }
      })
    }).pipe(
      Effect.catchTag("CapabilityMissing", (error) =>
        Effect.fail(
          _missing({
            capability: "shield.bot_detection",
            workaround: `bot detection needs the ${_nextPlan(policy.plan)} shield plan or higher (${error.capability})`
          })
        ))
    )
  }

  const _deleteStaleRules = (
    { keep, shieldZoneId }: { readonly shieldZoneId: number; readonly keep: ReadonlyArray<string> }
  ): Effect.Effect<void, CdnError> =>
    Effect.gen(function*() {
      const owned = yield* _ownedRules
      const existing = yield* client.listRateLimits(shieldZoneId)

      const stale = Object.entries(owned).flatMap(([name, id]) =>
        keep.includes(name) || !existing.some((rule) => rule.id === id) ? [] : [id]
      )

      yield* Effect.forEach(stale, (id) => client.deleteRateLimit(id), { discard: true })
    })

  const _convergeRules = (
    { policy, shieldZoneId }: { readonly shieldZoneId: number; readonly policy: SecurityPolicy }
  ): Effect.Effect<Record<string, number>, CdnError> =>
    Effect.gen(function*() {
      yield* _deleteStaleRules({ shieldZoneId, keep: policy.rateLimits.map((rule) => rule.name) })
      const existing = yield* client.listRateLimits(shieldZoneId)
      const owned = yield* _ownedRules

      const ids = yield* Effect.forEach(policy.rateLimits, (rule) =>
        Effect.gen(function*() {
          const configuration = yield* _rateConfig(rule)
          const found = existing.find((candidate) => candidate.id === owned[rule.name])

          if (found === undefined && existing.some((candidate) => candidate.ruleName === rule.name)) {
            return yield* Effect.fail(new ResourceConflict({ kind: "ratelimit", ref: rule.name }))
          }

          if (found === undefined) {
            const created = yield* client.createRateLimit({ shieldZoneId, ruleName: rule.name, ruleConfiguration: configuration })

            return [rule.name, created.id] as const
          }

          if (!_sameRule({ current: found.ruleConfiguration, desired: configuration })) {
            yield* client.updateRateLimit({ id: found.id, ruleName: rule.name, ruleConfiguration: configuration })
          }

          return [rule.name, found.id] as const
        }))

      return Object.fromEntries(ids)
    })

  const _convergeListContent = (
    { list, shieldZoneId }: { readonly shieldZoneId: number; readonly list: AccessList }
  ): Effect.Effect<void, CdnError> =>
    Effect.gen(function*() {
      const overview = yield* client.listAccessLists(shieldZoneId)
      const owned = yield* _ownedLists
      const found = overview.customLists.find((candidate) => candidate.listId === owned[list.name])
      const type = _listTypes[list.type]

      if (found === undefined && overview.customLists.some((candidate) => candidate.name === list.name)) {
        return yield* Effect.fail(new ResourceConflict({ kind: "accesslist", ref: list.name }))
      }

      if (found !== undefined && found.type !== type) {
        yield* client.deleteAccessList({ shieldZoneId, id: found.listId })
      }

      if (found === undefined || found.type !== type) {
        yield* client.createAccessList({ shieldZoneId, name: list.name, type, content: _content(list.entries) })

        return
      }

      const current = yield* client.getAccessList({ shieldZoneId, id: found.listId })
      const currentEntries = (current.content ?? "").split("\n")

      if (!_sameEntries({ left: currentEntries, right: list.entries })) {
        yield* client.updateAccessList({ shieldZoneId, id: found.listId, content: _content(list.entries) })
      }
    })

  const _deleteStaleLists = (
    { keep, shieldZoneId }: { readonly shieldZoneId: number; readonly keep: ReadonlyArray<string> }
  ): Effect.Effect<void, CdnError> =>
    Effect.gen(function*() {
      const owned = yield* _ownedLists
      const overview = yield* client.listAccessLists(shieldZoneId)

      const stale = Object.entries(owned).flatMap(([name, id]) =>
        keep.includes(name) || !overview.customLists.some((list) => list.listId === id) ? [] : [id]
      )

      yield* Effect.forEach(stale, (id) => client.deleteAccessList({ shieldZoneId, id }), { discard: true })
    })

  const _convergeListActions = (
    { policy, shieldZoneId }: { readonly shieldZoneId: number; readonly policy: SecurityPolicy }
  ): Effect.Effect<Record<string, number>, CdnError> =>
    Effect.gen(function*() {
      const overview = yield* client.listAccessLists(shieldZoneId)

      const ids = yield* Effect.forEach(policy.accessLists, (list) =>
        Effect.gen(function*() {
          const found = overview.customLists.find((candidate) => candidate.name === list.name)

          if (found === undefined) return [list.name, 0] as const

          const action = _listActions[list.action]

          if (found.action !== action || !found.isEnabled) {
            yield* client.updateAccessListConfiguration({
              shieldZoneId,
              configurationId: found.configurationId,
              isEnabled: true,
              action
            })
          }

          return [list.name, found.listId] as const
        }))

      return Object.fromEntries(ids)
    })

  const _convergeLists = (
    { policy, shieldZoneId }: { readonly shieldZoneId: number; readonly policy: SecurityPolicy }
  ): Effect.Effect<Record<string, number>, CdnError> =>
    Effect.gen(function*() {
      yield* _deleteStaleLists({ shieldZoneId, keep: policy.accessLists.map((list) => list.name) })
      yield* Effect.forEach(policy.accessLists, (list) => _convergeListContent({ shieldZoneId, list }), { discard: true })

      return yield* _convergeListActions({ shieldZoneId, policy })
    })

  const ensureSecurity = (
    { policy, ref }: { readonly ref: EdgeRef; readonly policy: SecurityPolicy }
  ): Effect.Effect<void, CdnError> =>
    Effect.gen(function*() {
      const zone = yield* _convergeZone({ pullZoneId: Number(ref.id), policy })
      const shieldZoneId = zone.shieldZoneId

      yield* _gate({ policy, zone })
      const overview = yield* client.listAccessLists(shieldZoneId)
      yield* _gateLists({ policy, limits: overview.limits })

      yield* _convergeBot({ policy, shieldZoneId })
      const rules = yield* _convergeRules({ policy, shieldZoneId })
      const lists = yield* _convergeLists({ policy, shieldZoneId })

      yield* Ref.update(outputs, (file) => ({ ...file, shieldZoneId, rules, lists }))
    })

  const resetSecurity = (ref: EdgeRef): Effect.Effect<void, CdnError> =>
    Effect.gen(function*() {
      const found = yield* client.getShieldZoneByPullZone(Number(ref.id))

      if (Option.isNone(found)) return

      const shieldZoneId = found.value.shieldZoneId

      yield* _deleteStaleRules({ shieldZoneId, keep: [] })
      yield* _deleteStaleLists({ shieldZoneId, keep: [] })

      yield* client.patchShieldZone({
        shieldZoneId,
        settings: { planType: "Basic", wafEnabled: false, dDoSShieldSensitivity: "Off", learningMode: false }
      })

      yield* Ref.update(outputs, (file) => ({ ...file, shieldZoneId, rules: {}, lists: {} }))
    })

  return { ensureSecurity, resetSecurity }
}
