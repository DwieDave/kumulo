import { Effect, Option, Predicate, Schema } from "effect"
import * as HttpClient from "effect/http/HttpClient"
import * as HttpClientRequest from "effect/http/HttpClientRequest"
import * as HttpClientResponse from "effect/http/HttpClientResponse"

type FakeJson = Schema.Json

type FakeRecord = { readonly [key: string]: FakeJson }

export type FakeShieldPlan = "Basic" | "Advanced" | "Business" | "Enterprise"

interface PlanLimits {
  readonly planType: number
  readonly rateLimitRulesLimit: number
  readonly customWafRulesLimit: number
  readonly customListLimit: number
  readonly customEntryLimit: number
}

const _planLimits: Readonly<Record<FakeShieldPlan, PlanLimits>> = {
  Basic: { planType: 0, rateLimitRulesLimit: 2, customWafRulesLimit: 1, customListLimit: 1, customEntryLimit: 100 },
  Advanced: { planType: 1, rateLimitRulesLimit: 5, customWafRulesLimit: 5, customListLimit: 3, customEntryLimit: 1000 },
  Business: { planType: 2, rateLimitRulesLimit: 20, customWafRulesLimit: 20, customListLimit: 10, customEntryLimit: 10000 },
  Enterprise: { planType: 3, rateLimitRulesLimit: 100, customWafRulesLimit: 100, customListLimit: 50, customEntryLimit: 100000 }
}

const _planOfType = (planType: number | undefined): FakeShieldPlan =>
  Object.entries(_planLimits).flatMap(([name, limits]) => (limits.planType === planType ? [name] : []))
    .reduce<FakeShieldPlan>((_, name) => name === "Advanced" || name === "Business" || name === "Enterprise" ? name : "Basic", "Basic")

const _isRecord = Schema.is(Schema.Record(Schema.String, Schema.Json))

const _decodeBody = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Record(Schema.String, Schema.Json)))

const _bodyOf = (request: HttpClientRequest.HttpClientRequest): FakeRecord =>
  Predicate.isTagged(request.body, "Uint8Array")
    ? Option.getOrElse(_decodeBody(new TextDecoder().decode(request.body.body)), () => ({}))
    : {}

const _number = (record: FakeRecord, key: string): number | undefined => {
  const value = record[key]

  return Predicate.isNumber(value) ? value : undefined
}

const _string = (record: FakeRecord, key: string): string => {
  const value = record[key]

  return Predicate.isString(value) ? value : ""
}

const _record = (record: FakeRecord, key: string): FakeRecord => {
  const value = record[key]

  return _isRecord(value) && !Array.isArray(value) ? value : {}
}

const _respond = ({ body, status }: { readonly status: number; readonly body?: FakeJson }): Response =>
  new Response(body === undefined ? null : JSON.stringify(body), { status })

const _failure = ({ errorKey, status }: { readonly status: number; readonly errorKey: string }): Response =>
  _respond({
    status,
    body: { error: { statusCode: status, success: false, errorKey, message: errorKey } }
  })

const _notFound = (errorKey: string): Response => _failure({ status: 404, errorKey })

const _entryCount = (content: string): number => content.split("\n").filter((line) => line.trim() !== "").length

const _botDefaults = (shieldZoneId: number) => ({
  shieldZoneId,
  executionMode: 0,
  requestIntegrity: { sensitivity: 0 },
  ipAddress: { sensitivity: 0 },
  browserFingerprint: { sensitivity: 0, aggression: 1, complexEnabled: false }
})

const _managedList = {
  listId: 9001,
  configurationId: 19001,
  name: "Managed threat list",
  description: "curated",
  isEnabled: false,
  type: 0,
  action: 0,
  entryCount: 1000
}

interface RouteContext {
  readonly request: HttpClientRequest.HttpClientRequest
  readonly body: FakeRecord
  readonly ids: ReadonlyArray<number>
}

type Route = readonly [method: string, pattern: RegExp, handler: (context: RouteContext) => Response]

export interface FakeShield {
  readonly httpClient: HttpClient.HttpClient
  readonly writes: () => number
  readonly zones: () => ReadonlyArray<FakeRecord>
  readonly rateLimits: () => ReadonlyArray<FakeRecord>
  readonly customLists: () => ReadonlyArray<FakeRecord>
  readonly seedRateLimit: (input: { readonly shieldZoneId: number; readonly ruleName: string }) => void
  readonly seedZone: (input: { readonly pullZoneId: number; readonly plan?: FakeShieldPlan }) => number
}

export const makeFakeShield = (options: { readonly plan?: FakeShieldPlan } = {}): FakeShield => {
  const defaultPlan = options.plan ?? "Basic"
  const zones = new Map<number, FakeRecord>()
  const rateLimits = new Map<number, FakeRecord>()
  const customLists = new Map<number, FakeRecord>()
  const configurations = new Map<number, FakeRecord>()
  const botDetections = new Map<number, FakeRecord>()
  configurations.set(9001, { configurationId: 19001, isEnabled: false, action: 0 })
  let nextId = 100
  let writeCount = 0

  const _nextId = (): number => {
    nextId += 1

    return nextId
  }

  const _limitsOf = (zone: FakeRecord): PlanLimits => _planLimits[_planOfType(_number(zone, "planType"))]

  const _buildZone = ({ pullZoneId, settings, shieldZoneId }: { readonly shieldZoneId: number; readonly pullZoneId: number; readonly settings: FakeRecord }) => {
    const limits = _planLimits[_planOfType(_number(settings, "planType") ?? _planLimits[defaultPlan].planType)]

    return {
      wafEnabled: false,
      wafExecutionMode: 0,
      dDoSShieldSensitivity: 1,
      dDoSExecutionMode: 0,
      whitelabelResponsePages: false,
      ...settings,
      shieldZoneId,
      pullZoneId,
      planType: limits.planType,
      rateLimitRulesLimit: limits.rateLimitRulesLimit,
      customWafRulesLimit: limits.customWafRulesLimit
    }
  }

  const _seedZone = ({ plan, pullZoneId }: { readonly pullZoneId: number; readonly plan?: FakeShieldPlan }): number => {
    const shieldZoneId = _nextId()
    zones.set(shieldZoneId, _buildZone({ shieldZoneId, pullZoneId, settings: { planType: _planLimits[plan ?? defaultPlan].planType } }))

    return shieldZoneId
  }

  const _zoneOr404 = (id: number | undefined, handler: (zone: FakeRecord) => Response): Response => {
    const zone = id === undefined ? undefined : zones.get(id)

    return zone === undefined ? _notFound("not_found.shield_zone") : handler(zone)
  }

  const _customDetails = (list: FakeRecord) => {
    const id = _number(list, "id") ?? 0
    const configuration = configurations.get(id) ?? {}

    return {
      listId: id,
      configurationId: _number(configuration, "configurationId") ?? 0,
      name: list.name ?? null,
      description: list.description ?? null,
      isEnabled: configuration.isEnabled ?? true,
      type: list.type ?? 0,
      action: configuration.action ?? 0,
      entryCount: list.entryCount ?? 0
    }
  }

  const _storeList = ({ body, id, previous }: { readonly id: number; readonly body: FakeRecord; readonly previous: FakeRecord }) => {
    const content = body.content === undefined ? _string(previous, "content") : _string(body, "content")

    return {
      ...previous,
      id,
      name: body.name ?? previous.name ?? null,
      description: body.description ?? previous.description ?? null,
      type: body.type ?? previous.type ?? 0,
      content,
      checksum: `sha256:${content.length}`,
      entryCount: _entryCount(content)
    }
  }

  const _rateLimitBody = ({ body, id, shieldZoneId }: { readonly id: number; readonly shieldZoneId: number; readonly body: FakeRecord }) => ({
    id,
    shieldZoneId,
    ruleName: body.ruleName ?? null,
    ruleDescription: body.ruleDescription ?? null,
    ruleConfiguration: body.ruleConfiguration ?? {}
  })

  const _rateLimitsOf = (shieldZoneId: number): ReadonlyArray<FakeRecord> =>
    [...rateLimits.values()].filter((rule) => _number(rule, "shieldZoneId") === shieldZoneId)

  const _botRoute = (handler: (input: { readonly zone: FakeRecord; readonly id: number }) => Response) => ({ ids }: RouteContext): Response =>
    _zoneOr404(ids[0], (zone) =>
      _planOfType(_number(zone, "planType")) === "Basic"
        ? _failure({ status: 202, errorKey: "invalid_plan_type.bot_detection" })
        : handler({ zone, id: ids[0] ?? 0 }))

  const _routes: ReadonlyArray<Route> = [
    ["GET", /^\/shield\/shield-zone\/get-by-pullzone\/(\d+)$/, ({ ids }) => {
      const found = [...zones.values()].find((zone) => _number(zone, "pullZoneId") === ids[0])

      return found === undefined ? _notFound("not_found.shield_zone") : _respond({ status: 200, body: { data: found } })
    }],
    ["GET", /^\/shield\/shield-zone\/(\d+)$/, ({ ids }) => _zoneOr404(ids[0], (zone) => _respond({ status: 200, body: { data: zone } }))],
    ["POST", /^\/shield\/shield-zone$/, ({ body }) => {
      const pullZoneId = _number(body, "pullZoneId") ?? 0

      if ([...zones.values()].some((zone) => _number(zone, "pullZoneId") === pullZoneId)) {
        return _failure({ status: 400, errorKey: "shieldzone.already_exists" })
      }

      const shieldZoneId = _nextId()
      zones.set(shieldZoneId, _buildZone({ shieldZoneId, pullZoneId, settings: _record(body, "shieldZone") }))

      return _respond({ status: 200, body: { data: { pullZoneId, shieldZone: { shieldZoneId } } } })
    }],
    ["PATCH", /^\/shield\/shield-zone$/, ({ body }) =>
      _zoneOr404(_number(body, "shieldZoneId"), (zone) => {
        const shieldZoneId = _number(zone, "shieldZoneId") ?? 0
        zones.set(shieldZoneId, _buildZone({ shieldZoneId, pullZoneId: _number(zone, "pullZoneId") ?? 0, settings: { ...zone, ..._record(body, "shieldZone") } }))

        return _respond({ status: 200, body: { data: { shieldZoneId } } })
      })],
    ["GET", /^\/shield\/rate-limits\/(\d+)$/, ({ ids, request }) =>
      _zoneOr404(ids[0], () => {
        const url = Option.getOrElse(HttpClientRequest.toUrl(request), () => new URL(request.url))
        const page = Number(url.searchParams.get("page") ?? "1")
        const perPage = Number(url.searchParams.get("perPage") ?? "10")

        return _respond({ status: 200, body: { data: _rateLimitsOf(ids[0] ?? 0).slice((page - 1) * perPage, page * perPage), page: null, error: null } })
      })],
    ["POST", /^\/shield\/rate-limit$/, ({ body }) =>
      _zoneOr404(_number(body, "shieldZoneId"), (zone) => {
        const shieldZoneId = _number(zone, "shieldZoneId") ?? 0

        if (_rateLimitsOf(shieldZoneId).length >= _limitsOf(zone).rateLimitRulesLimit) {
          return _failure({ status: 202, errorKey: "limit_reached.waf" })
        }

        const id = _nextId()
        const rule = _rateLimitBody({ id, shieldZoneId, body })
        rateLimits.set(id, rule)

        return _respond({ status: 200, body: rule })
      })],
    ["GET", /^\/shield\/rate-limit\/(\d+)$/, ({ ids }) => {
      const rule = rateLimits.get(ids[0] ?? 0)

      return rule === undefined ? _notFound("not_found_or_unauthorised_access.waf_rule") : _respond({ status: 200, body: rule })
    }],
    ["PATCH", /^\/shield\/rate-limit\/(\d+)$/, ({ body, ids }) => {
      const rule = rateLimits.get(ids[0] ?? 0)

      if (rule === undefined) return _notFound("not_found_or_unauthorised_access.waf_rule")

      const updated = _rateLimitBody({ id: ids[0] ?? 0, shieldZoneId: _number(rule, "shieldZoneId") ?? 0, body })
      rateLimits.set(ids[0] ?? 0, updated)

      return _respond({ status: 200, body: updated })
    }],
    ["DELETE", /^\/shield\/rate-limit\/(\d+)$/, ({ ids }) =>
      rateLimits.delete(ids[0] ?? 0) ? _respond({ status: 200 }) : _notFound("not_found_or_unauthorised_access.waf_rule")],
    ["GET", /^\/shield\/shield-zone\/(\d+)\/access-lists$/, ({ ids }) =>
      _zoneOr404(ids[0], (zone) => {
        const lists = [...customLists.values()].filter((list) => _number(list, "shieldZoneId") === ids[0])

        return _respond({
          status: 200,
          body: {
            managedLists: [{ ..._managedList, isEnabled: configurations.get(9001)?.isEnabled ?? false, action: configurations.get(9001)?.action ?? 0 }],
            customLists: lists.map(_customDetails),
            customListCount: lists.length,
            customListLimit: _limitsOf(zone).customListLimit,
            customEntryCount: lists.reduce((sum, list) => sum + (_number(list, "entryCount") ?? 0), 0),
            customEntryLimit: _limitsOf(zone).customEntryLimit
          }
        })
      })],
    ["POST", /^\/shield\/shield-zone\/(\d+)\/access-lists$/, ({ body, ids }) =>
      _zoneOr404(ids[0], (zone) => {
        const existing = [...customLists.values()].filter((list) => _number(list, "shieldZoneId") === ids[0])

        if (existing.length >= _limitsOf(zone).customListLimit) {
          return _failure({ status: 202, errorKey: "limit_reached.access_list" })
        }

        if (existing.some((list) => _string(list, "name") === _string(body, "name"))) {
          return _failure({ status: 400, errorKey: "access_list.already_exists" })
        }

        const id = _nextId()
        const list = { ..._storeList({ id, body, previous: {} }), shieldZoneId: ids[0] ?? 0 }
        customLists.set(id, list)
        configurations.set(id, { configurationId: id + 1000, isEnabled: true, action: 0 })

        return _respond({ status: 200, body: { data: list } })
      })],
    ["GET", /^\/shield\/shield-zone\/(\d+)\/access-lists\/(\d+)$/, ({ ids }) => {
      const list = customLists.get(ids[1] ?? 0)

      return list === undefined || _number(list, "shieldZoneId") !== ids[0]
        ? _notFound("not_found.access_list")
        : _respond({ status: 200, body: { data: list } })
    }],
    ["PATCH", /^\/shield\/shield-zone\/(\d+)\/access-lists\/configurations\/(\d+)$/, ({ body, ids }) => {
      const entry = [...configurations.entries()].find(([, configuration]) => _number(configuration, "configurationId") === ids[1])

      if (entry === undefined) return _notFound("not_found.access_list_configuration")

      configurations.set(entry[0], {
        ...entry[1],
        isEnabled: body.isEnabled ?? entry[1].isEnabled ?? true,
        action: body.action ?? entry[1].action ?? 0
      })

      return _respond({ status: 200, body: { data: body } })
    }],
    ["PATCH", /^\/shield\/shield-zone\/(\d+)\/access-lists\/(\d+)$/, ({ body, ids }) => {
      const list = customLists.get(ids[1] ?? 0)

      if (list === undefined || _number(list, "shieldZoneId") !== ids[0]) return _notFound("not_found.access_list")

      const updated = { ..._storeList({ id: ids[1] ?? 0, body, previous: list }), shieldZoneId: ids[0] ?? 0 }
      customLists.set(ids[1] ?? 0, updated)

      return _respond({ status: 200, body: { data: updated } })
    }],
    ["DELETE", /^\/shield\/shield-zone\/(\d+)\/access-lists\/(\d+)$/, ({ ids }) => {
      const list = customLists.get(ids[1] ?? 0)

      if (list === undefined || _number(list, "shieldZoneId") !== ids[0]) return _notFound("not_found.access_list")

      customLists.delete(ids[1] ?? 0)
      configurations.delete(ids[1] ?? 0)

      return _respond({ status: 200 })
    }],
    ["GET", /^\/shield\/shield-zone\/(\d+)\/bot-detection$/, _botRoute(({ id }) =>
      _respond({ status: 200, body: { data: botDetections.get(id) ?? _botDefaults(id) } }))],
    ["PATCH", /^\/shield\/shield-zone\/(\d+)\/bot-detection$/, (context) =>
      _botRoute(({ id }) => {
        const updated = { ...(botDetections.get(id) ?? _botDefaults(id)), ...context.body, shieldZoneId: id }
        botDetections.set(id, updated)

        return _respond({ status: 200, body: { data: updated } })
      })(context)]
  ]

  const _handle = (request: HttpClientRequest.HttpClientRequest): Response => {
    const url = Option.getOrElse(HttpClientRequest.toUrl(request), () => new URL(request.url))

    if (request.method !== "GET") writeCount += 1

    const matched = _routes.flatMap(([method, pattern, handler]) => {
      const match = method === request.method ? pattern.exec(url.pathname) : null

      return match === null ? [] : [{ handler, ids: match.slice(1).map(Number) }]
    })[0]

    return matched === undefined
      ? _failure({ status: 404, errorKey: "not_found.route" })
      : matched.handler({ request, body: _bodyOf(request), ids: matched.ids })
  }

  const httpClient = HttpClient.make((request) => Effect.succeed(HttpClientResponse.fromWeb(request, _handle(request)))).pipe(
    HttpClient.mapRequest(HttpClientRequest.prependUrl("https://fixture.invalid"))
  )

  return {
    httpClient,
    writes: () => writeCount,
    zones: () => [...zones.values()],
    rateLimits: () => [...rateLimits.values()],
    customLists: () => [...customLists.values()],
    seedRateLimit: ({ ruleName, shieldZoneId }) => {
      const id = _nextId()
      rateLimits.set(id, _rateLimitBody({ id, shieldZoneId, body: { ruleName, ruleConfiguration: { actionType: 1, counterKeyType: 0, operatorType: 0, requestCount: 100, timeframe: 60, blockTime: 300, value: "/api" } } }))
    },
    seedZone: _seedZone
  }
}
