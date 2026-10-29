import { Effect, Option, Predicate } from "effect"
import * as HttpClient from "effect/http/HttpClient"
import * as HttpClientRequest from "effect/http/HttpClientRequest"
import * as HttpClientResponse from "effect/http/HttpClientResponse"
import { assert, describe, it } from "@effect/vitest"
import { makeBunnyShieldClient } from "../../src/client/shield.ts"
import type { BunnyRateLimitConfiguration } from "../../src/client/shield.ts"
import { makeFakeShield } from "../../src/testing/fake-shield.ts"
import type { FakeShieldPlan } from "../../src/testing/fake-shield.ts"

const _setup = (plan: FakeShieldPlan = "Basic") => {
  const fake = makeFakeShield({ plan })
  const shield = makeBunnyShieldClient(fake.httpClient)
  const shieldZoneId = fake.seedZone({ pullZoneId: 7 })

  return { fake, shield, shieldZoneId }
}

const _config: BunnyRateLimitConfiguration = {
  actionType: 1,
  counterKeyType: "IP",
  operatorType: 0,
  requestCount: 100,
  timeframe: "PerOneMinute",
  blockTime: "ForFiveMinutes",
  value: "/api"
}

const _stub = (status: number) =>
  makeBunnyShieldClient(
    HttpClient.make((request) =>
      Effect.succeed(HttpClientResponse.fromWeb(request, new Response(JSON.stringify({ error: { statusCode: status, success: false, errorKey: "x", message: "x" } }), { status })))
    ).pipe(HttpClient.mapRequest(HttpClientRequest.prependUrl("https://fixture.invalid")))
  )

const _rule = (shieldZoneId: number, ruleName: string) => ({ shieldZoneId, ruleName, ruleConfiguration: _config })

describe("shield zones", () => {
  it.effect("getShieldZone surfaces plan and runtime limits", () =>
    Effect.gen(function*() {
      const { shield, shieldZoneId } = _setup()
      const zone = yield* shield.getShieldZone(shieldZoneId)
      assert.strictEqual(zone.planType, "Basic")
      assert.strictEqual(zone.rateLimitRulesLimit, 2)
      assert.strictEqual(zone.customWafRulesLimit, 1)
    }))

  it.effect("limits scale with the plan", () =>
    Effect.gen(function*() {
      const { shield, shieldZoneId } = _setup("Business")
      const zone = yield* shield.getShieldZone(shieldZoneId)
      assert.strictEqual(zone.planType, "Business")
      assert.strictEqual(zone.rateLimitRulesLimit, 20)
    }))

  it.effect("getShieldZone maps a missing zone to ResourceNotFound", () =>
    Effect.gen(function*() {
      const { shield } = _setup()
      const error = yield* Effect.flip(shield.getShieldZone(999))
      assert.isTrue(Predicate.isTagged(error, "ResourceNotFound"))
    }))

  it.effect("getShieldZoneByPullZone returns some for a mapped pull zone and none otherwise", () =>
    Effect.gen(function*() {
      const { shield, shieldZoneId } = _setup()
      const found = yield* shield.getShieldZoneByPullZone(7)
      assert.strictEqual(Option.map(found, (zone) => zone.shieldZoneId).pipe(Option.getOrUndefined), shieldZoneId)
      assert.isTrue(Option.isNone(yield* shield.getShieldZoneByPullZone(8)))
    }))

  it.effect("getShieldZoneByPullZone returns none on a 202 response and on 404", () =>
    Effect.gen(function*() {
      assert.isTrue(Option.isNone(yield* _stub(202).getShieldZoneByPullZone(7)))
      assert.isTrue(Option.isNone(yield* _stub(404).getShieldZoneByPullZone(7)))
    }))

  it.effect("listRateLimits pages through every rule", () =>
    Effect.gen(function*() {
      const { fake, shield, shieldZoneId } = _setup()
      Array.from({ length: 250 }, (_, index) => fake.seedRateLimit({ shieldZoneId, ruleName: `rule-${index}` }))
      const rules = yield* shield.listRateLimits(shieldZoneId)
      assert.strictEqual(rules.length, 250)
    }))

  it.effect("createShieldZone creates and reads back the zone", () =>
    Effect.gen(function*() {
      const { fake, shield } = _setup()
      const zone = yield* shield.createShieldZone({ pullZoneId: 55, settings: { planType: "Advanced", wafEnabled: true, wafExecutionMode: "Block" } })
      assert.strictEqual(zone.pullZoneId, 55)
      assert.strictEqual(zone.planType, "Advanced")
      assert.strictEqual(zone.wafEnabled, true)
      assert.strictEqual(zone.wafExecutionMode, "Block")
      assert.strictEqual(zone.rateLimitRulesLimit, 5)
      assert.strictEqual(fake.zones().length, 2)
    }))

  it.effect("createShieldZone for an existing pull zone is ResourceConflict", () =>
    Effect.gen(function*() {
      const { shield } = _setup()
      const error = yield* Effect.flip(shield.createShieldZone({ pullZoneId: 7, settings: {} }))
      assert.isTrue(Predicate.isTagged(error, "ResourceConflict"))
    }))

  it.effect("patchShieldZone applies settings and returns the new zone", () =>
    Effect.gen(function*() {
      const { shield, shieldZoneId } = _setup()

      const zone = yield* shield.patchShieldZone({
        shieldZoneId,
        settings: { wafEnabled: true, dDoSShieldSensitivity: "High", dDoSExecutionMode: "Block", planType: "Business" }
      })

      assert.strictEqual(zone.wafEnabled, true)
      assert.strictEqual(zone.dDoSShieldSensitivity, "High")
      assert.strictEqual(zone.dDoSExecutionMode, "Block")
      assert.strictEqual(zone.rateLimitRulesLimit, 20)
    }))

  it.effect("patchShieldZone on a missing zone is ResourceNotFound", () =>
    Effect.gen(function*() {
      const { shield } = _setup()
      const error = yield* Effect.flip(shield.patchShieldZone({ shieldZoneId: 999, settings: {} }))
      assert.isTrue(Predicate.isTagged(error, "ResourceNotFound"))
    }))
})

describe("rate limits", () => {
  it.effect("create, get, list, update, delete round-trip", () =>
    Effect.gen(function*() {
      const { fake, shield, shieldZoneId } = _setup()
      const created = yield* shield.createRateLimit({ ...(_rule(shieldZoneId, "api")), ruleDescription: "api limit" })
      assert.strictEqual(created.ruleName, "api")
      assert.strictEqual(created.ruleConfiguration.timeframe, "PerOneMinute")
      assert.strictEqual(created.ruleConfiguration.blockTime, "ForFiveMinutes")
      assert.strictEqual(created.ruleConfiguration.counterKeyType, "IP")
      assert.deepStrictEqual((yield* shield.getRateLimit(created.id)).ruleName, "api")
      assert.strictEqual((yield* shield.listRateLimits(shieldZoneId)).length, 1)

      const updated = yield* shield.updateRateLimit({
        id: created.id,
        ruleName: "api2",
        ruleConfiguration: { ..._config, requestCount: 5, timeframe: "PerSecond" }
      })

      assert.strictEqual(updated.ruleName, "api2")
      assert.strictEqual(updated.ruleConfiguration.requestCount, 5)
      assert.strictEqual(updated.ruleConfiguration.timeframe, "PerSecond")

      yield* shield.deleteRateLimit(created.id)
      assert.strictEqual(fake.rateLimits().length, 0)
      assert.strictEqual((yield* shield.listRateLimits(shieldZoneId)).length, 0)
    }))

  it.effect("basic plan allows two rate limits and rejects the third", () =>
    Effect.gen(function*() {
      const { shield, shieldZoneId } = _setup()
      yield* shield.createRateLimit(_rule(shieldZoneId, "a"))
      yield* shield.createRateLimit(_rule(shieldZoneId, "b"))
      const error = yield* Effect.flip(shield.createRateLimit(_rule(shieldZoneId, "c")))
      assert.isTrue(Predicate.isTagged(error, "ProviderApiError"))
      assert.isTrue(Predicate.isTagged(error, "ProviderApiError") && error.status === 202)
      assert.strictEqual((yield* shield.listRateLimits(shieldZoneId)).length, 2)
    }))

  it.effect("limits are per zone", () =>
    Effect.gen(function*() {
      const { fake, shield, shieldZoneId } = _setup()
      const other = fake.seedZone({ pullZoneId: 8 })
      yield* shield.createRateLimit(_rule(shieldZoneId, "a"))
      yield* shield.createRateLimit(_rule(shieldZoneId, "b"))
      yield* shield.createRateLimit(_rule(other, "c"))
      assert.strictEqual((yield* shield.listRateLimits(other)).length, 1)
    }))

  it.effect("missing rules map to ResourceNotFound for get, update and delete", () =>
    Effect.gen(function*() {
      const { shield } = _setup()

      const errors = [
        yield* Effect.flip(shield.getRateLimit(999)),
        yield* Effect.flip(shield.updateRateLimit({ id: 999, ruleName: "x", ruleConfiguration: _config })),
        yield* Effect.flip(shield.deleteRateLimit(999))
      ]

      assert.isTrue(errors.every((error) => Predicate.isTagged(error, "ResourceNotFound")))
    }))

  it.effect("creating in a missing zone is ResourceNotFound", () =>
    Effect.gen(function*() {
      const { shield } = _setup()
      const error = yield* Effect.flip(shield.createRateLimit(_rule(999, "x")))
      assert.isTrue(Predicate.isTagged(error, "ResourceNotFound"))
    }))
})

describe("access lists", () => {
  it.effect("list reports managed lists and plan limits", () =>
    Effect.gen(function*() {
      const { shield, shieldZoneId } = _setup()
      const overview = yield* shield.listAccessLists(shieldZoneId)
      assert.strictEqual(overview.managedLists.length, 1)
      assert.strictEqual(overview.customLists.length, 0)
      assert.deepStrictEqual(overview.limits, { customListLimit: 1, customListCount: 0, customEntryLimit: 100, customEntryCount: 0 })
    }))

  it.effect("create, get, update, delete round-trip", () =>
    Effect.gen(function*() {
      const { fake, shield, shieldZoneId } = _setup("Advanced")
      const created = yield* shield.createAccessList({ shieldZoneId, name: "office", type: "IP", content: "1.1.1.1\n2.2.2.2" })
      assert.strictEqual(created.name, "office")
      assert.strictEqual(created.type, "IP")
      assert.strictEqual(created.entryCount, 2)
      assert.strictEqual((yield* shield.getAccessList({ shieldZoneId, id: created.id })).content, "1.1.1.1\n2.2.2.2")

      const updated = yield* shield.updateAccessList({ shieldZoneId, id: created.id, content: "3.3.3.3" })
      assert.strictEqual(updated.entryCount, 1)
      assert.strictEqual(updated.name, "office")

      const overview = yield* shield.listAccessLists(shieldZoneId)
      assert.strictEqual(overview.customLists.length, 1)
      assert.strictEqual(overview.limits.customEntryCount, 1)
      assert.strictEqual(overview.limits.customListCount, 1)

      yield* shield.deleteAccessList({ shieldZoneId, id: created.id })
      assert.strictEqual(fake.customLists().length, 0)
    }))

  it.effect("exceeding the custom list limit is a 202 provider error", () =>
    Effect.gen(function*() {
      const { shield, shieldZoneId } = _setup()
      yield* shield.createAccessList({ shieldZoneId, name: "a", type: "IP" })
      const error = yield* Effect.flip(shield.createAccessList({ shieldZoneId, name: "b", type: "IP" }))
      assert.isTrue(Predicate.isTagged(error, "ProviderApiError") && error.status === 202)
    }))

  it.effect("duplicate names are ResourceConflict", () =>
    Effect.gen(function*() {
      const { shield, shieldZoneId } = _setup("Advanced")
      yield* shield.createAccessList({ shieldZoneId, name: "a", type: "CIDR" })
      const error = yield* Effect.flip(shield.createAccessList({ shieldZoneId, name: "a", type: "CIDR" }))
      assert.isTrue(Predicate.isTagged(error, "ResourceConflict"))
    }))

  it.effect("missing lists map to ResourceNotFound", () =>
    Effect.gen(function*() {
      const { shield, shieldZoneId } = _setup()

      const errors = [
        yield* Effect.flip(shield.getAccessList({ shieldZoneId, id: 999 })),
        yield* Effect.flip(shield.updateAccessList({ shieldZoneId, id: 999, name: "x" })),
        yield* Effect.flip(shield.deleteAccessList({ shieldZoneId, id: 999 }))
      ]

      assert.isTrue(errors.every((error) => Predicate.isTagged(error, "ResourceNotFound")))
    }))

  it.effect("configuration patch toggles a custom list and a managed list", () =>
    Effect.gen(function*() {
      const { shield, shieldZoneId } = _setup()
      const created = yield* shield.createAccessList({ shieldZoneId, name: "a", type: "IP" })
      const before = yield* shield.listAccessLists(shieldZoneId)
      const custom = before.customLists[0]
      assert.strictEqual(custom?.isEnabled, true)
      assert.strictEqual(custom?.listId, created.id)

      yield* shield.updateAccessListConfiguration({ shieldZoneId, configurationId: custom?.configurationId ?? 0, isEnabled: false, action: "Block" })
      const afterCustom = (yield* shield.listAccessLists(shieldZoneId)).customLists[0]
      assert.strictEqual(afterCustom?.isEnabled, false)
      assert.strictEqual(afterCustom?.action, "Block")

      const managed = before.managedLists[0]
      yield* shield.updateAccessListConfiguration({ shieldZoneId, configurationId: managed?.configurationId ?? 0, isEnabled: true })
      assert.strictEqual(managed?.isEnabled, false)
      assert.strictEqual((yield* shield.listAccessLists(shieldZoneId)).managedLists[0]?.isEnabled, true)
    }))

  it.effect("configuration patch on an unknown id is ResourceNotFound", () =>
    Effect.gen(function*() {
      const { shield, shieldZoneId } = _setup()
      const error = yield* Effect.flip(shield.updateAccessListConfiguration({ shieldZoneId, configurationId: 424242, isEnabled: true }))
      assert.isTrue(Predicate.isTagged(error, "ResourceNotFound"))
    }))
})

describe("bot detection", () => {
  it.effect("basic plan yields CapabilityMissing for get and update", () =>
    Effect.gen(function*() {
      const { shield, shieldZoneId } = _setup()
      const getError = yield* Effect.flip(shield.getBotDetection(shieldZoneId))
      const patchError = yield* Effect.flip(shield.updateBotDetection({ shieldZoneId, executionMode: "Challenge" }))
      assert.isTrue(Predicate.isTagged(getError, "CapabilityMissing"))
      assert.isTrue(Predicate.isTagged(getError, "CapabilityMissing") && getError.capability === "invalid_plan_type.bot_detection")
      assert.isTrue(Predicate.isTagged(patchError, "CapabilityMissing"))
    }))

  it.effect("higher plans read and patch the configuration", () =>
    Effect.gen(function*() {
      const { shield, shieldZoneId } = _setup("Advanced")
      const initial = yield* shield.getBotDetection(shieldZoneId)
      assert.strictEqual(initial.executionMode, "LogOnly")
      assert.strictEqual(initial.ipAddress.sensitivity, "Off")

      const updated = yield* shield.updateBotDetection({
        shieldZoneId,
        executionMode: "Challenge",
        ipAddress: { sensitivity: "High" },
        browserFingerprint: { sensitivity: "Medium", aggression: 2 }
      })

      assert.strictEqual(updated.executionMode, "Challenge")
      assert.strictEqual(updated.ipAddress.sensitivity, "High")
      assert.strictEqual(updated.browserFingerprint.sensitivity, "Medium")
      assert.strictEqual(updated.browserFingerprint.aggression, 2)
      assert.strictEqual(updated.requestIntegrity.sensitivity, "Off")
    }))

  it.effect("missing zone is ResourceNotFound", () =>
    Effect.gen(function*() {
      const { shield } = _setup()
      const error = yield* Effect.flip(shield.getBotDetection(999))
      assert.isTrue(Predicate.isTagged(error, "ResourceNotFound"))
    }))
})

describe("fake server accounting", () => {
  it.effect("reads do not count as writes", () =>
    Effect.gen(function*() {
      const { fake, shield, shieldZoneId } = _setup()
      yield* shield.getShieldZone(shieldZoneId)
      yield* shield.listRateLimits(shieldZoneId)
      yield* shield.listAccessLists(shieldZoneId)
      assert.strictEqual(fake.writes(), 0)
      yield* shield.createRateLimit(_rule(shieldZoneId, "a"))
      assert.strictEqual(fake.writes(), 1)
    }))
})
