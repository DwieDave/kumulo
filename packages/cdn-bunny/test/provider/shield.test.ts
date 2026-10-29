import { Cause, Effect, Exit, Option, Ref } from "effect"
import { assert, describe, it } from "@effect/vitest"
import { CapabilityMissing, ResourceConflict } from "@kumulo/core"
import type { CdnError, EdgeRef, SecurityPolicy } from "@kumulo/core"
import { makeBunnyShieldClient, makeFakeShield } from "@kumulo/bunny"
import type { FakeShieldPlan } from "@kumulo/bunny"
import { emptyCdnOutputs } from "../../src/outputs.ts"
import { makeBunnyShield } from "../../src/provider/shield.ts"

const _workaround = (exit: Exit.Exit<void, CdnError>): string => {
  const error = Exit.isFailure(exit) ? Option.getOrUndefined(Cause.findErrorOption(exit.cause)) : undefined

  return error instanceof CapabilityMissing ? (error.workaround ?? "") : ""
}

const _ref: EdgeRef = { id: "7", name: "acme" }

const _policy: SecurityPolicy = {
  plan: "advanced",
  waf: { enabled: true, mode: "block" },
  ddos: { sensitivity: "high" },
  botDetection: { mode: "block", sensitivity: "medium" },
  rateLimits: [{ name: "login", pathPrefix: "/login", requests: 10, window: "60", blockFor: "300", key: "ip" }],
  accessLists: [{ name: "office", type: "cidr", action: "allow", entries: ["10.0.0.0/8", "192.168.0.0/16"] }]
}

const _setup = (plan?: FakeShieldPlan) => {
  const fake = makeFakeShield(plan === undefined ? {} : { plan })
  const outputs = Ref.makeUnsafe(emptyCdnOutputs("stg"))
  const shield = makeBunnyShield({ shield: makeBunnyShieldClient(fake.httpClient), outputs })

  return { fake, outputs, shield }
}

describe("ensureSecurity", () => {
  it.effect("creates the zone, settings, rules and lists and records ids", () =>
    Effect.gen(function*() {
      const { fake, outputs, shield } = _setup()
      yield* shield.ensureSecurity({ ref: _ref, policy: _policy })
      const zone = fake.zones()[0]
      assert.strictEqual(zone?.planType, 1)
      assert.strictEqual(zone?.wafEnabled, true)
      assert.strictEqual(zone?.wafExecutionMode, 1)
      assert.strictEqual(zone?.dDoSShieldSensitivity, 3)
      assert.strictEqual(zone?.learningMode, false)
      assert.strictEqual(fake.rateLimits().length, 1)
      assert.strictEqual(fake.customLists().length, 1)
      const file = yield* Ref.get(outputs)
      assert.strictEqual(file.shieldZoneId, zone?.shieldZoneId)
      assert.strictEqual(file.rules["login"], fake.rateLimits()[0]?.id)
      assert.strictEqual(file.lists["office"], fake.customLists()[0]?.id)
    }))

  it.effect("a second apply performs zero writes", () =>
    Effect.gen(function*() {
      const { fake, shield } = _setup()
      yield* shield.ensureSecurity({ ref: _ref, policy: _policy })
      const before = fake.writes()
      yield* shield.ensureSecurity({ ref: _ref, policy: _policy })
      assert.strictEqual(fake.writes(), before)
    }))

  it.effect("sets list action through the configurations endpoint", () =>
    Effect.gen(function*() {
      const { fake, shield } = _setup()
      yield* shield.ensureSecurity({ ref: _ref, policy: _policy })
      const changed = { ..._policy, accessLists: [{ ...(_policy.accessLists[0] ?? { name: "office", type: "cidr" as const, entries: [] }), action: "block" as const }] }
      const before = fake.writes()
      yield* shield.ensureSecurity({ ref: _ref, policy: changed })
      assert.strictEqual(fake.writes(), before + 1)
    }))

  it.effect("compares entries sorted and deduped", () =>
    Effect.gen(function*() {
      const { fake, shield } = _setup()
      yield* shield.ensureSecurity({ ref: _ref, policy: _policy })
      const before = fake.writes()

      const shuffled = {
        ..._policy,
        accessLists: [{ name: "office", type: "cidr" as const, action: "allow" as const, entries: ["192.168.0.0/16", "10.0.0.0/8", "10.0.0.0/8"] }]
      }

      yield* shield.ensureSecurity({ ref: _ref, policy: shuffled })
      assert.strictEqual(fake.writes(), before)
      const grown = { ...shuffled, accessLists: [{ ...(shuffled.accessLists[0] ?? { name: "office", type: "cidr" as const, action: "allow" as const }), entries: ["10.0.0.0/8"] }] }
      yield* shield.ensureSecurity({ ref: _ref, policy: grown })
      assert.strictEqual(fake.writes(), before + 1)
    }))

  it.effect("updates a rate limit in place when its settings change", () =>
    Effect.gen(function*() {
      const { fake, shield } = _setup()
      yield* shield.ensureSecurity({ ref: _ref, policy: _policy })
      const id = fake.rateLimits()[0]?.id
      yield* shield.ensureSecurity({
        ref: _ref,
        policy: { ..._policy, rateLimits: [{ name: "login", pathPrefix: "/login", requests: 20, window: "60", blockFor: "300", key: "ip" }] }
      })
      assert.strictEqual(fake.rateLimits().length, 1)
      assert.strictEqual(fake.rateLimits()[0]?.id, id)
    }))

  it.effect("rename deletes the old rule and list and creates new ones", () =>
    Effect.gen(function*() {
      const { fake, outputs, shield } = _setup()
      yield* shield.ensureSecurity({ ref: _ref, policy: _policy })
      const oldRule = fake.rateLimits()[0]?.id

      const renamed: SecurityPolicy = {
        ..._policy,
        rateLimits: [{ name: "signin", pathPrefix: "/login", requests: 10, window: "60", blockFor: "300", key: "ip" }],
        accessLists: [{ name: "hq", type: "cidr", action: "allow", entries: ["10.0.0.0/8"] }]
      }

      yield* shield.ensureSecurity({ ref: _ref, policy: renamed })
      assert.strictEqual(fake.rateLimits().length, 1)
      assert.notStrictEqual(fake.rateLimits()[0]?.id, oldRule)
      assert.strictEqual(fake.rateLimits()[0]?.ruleName, "signin")
      assert.strictEqual(fake.customLists().length, 1)
      assert.strictEqual(fake.customLists()[0]?.name, "hq")
      const file = yield* Ref.get(outputs)
      assert.deepStrictEqual(Object.keys(file.rules), ["signin"])
      assert.deepStrictEqual(Object.keys(file.lists), ["hq"])
    }))

  it.effect("deletes owned rules no longer configured", () =>
    Effect.gen(function*() {
      const { fake, shield } = _setup()
      yield* shield.ensureSecurity({ ref: _ref, policy: _policy })
      yield* shield.ensureSecurity({ ref: _ref, policy: { ..._policy, rateLimits: [], accessLists: [] } })
      assert.strictEqual(fake.rateLimits().length, 0)
      assert.strictEqual(fake.customLists().length, 0)
    }))

  it.effect("adopts an existing zone and patches drift", () =>
    Effect.gen(function*() {
      const { fake, shield } = _setup()
      fake.seedZone({ pullZoneId: 7 })
      yield* shield.ensureSecurity({ ref: _ref, policy: _policy })
      assert.strictEqual(fake.zones().length, 1)
      assert.strictEqual(fake.zones()[0]?.planType, 1)
      assert.strictEqual(fake.zones()[0]?.wafEnabled, true)
    }))
})

describe("ownership", () => {
  it.effect("fails with ResourceConflict on a same-named rule or list that is not owned", () =>
    Effect.gen(function*() {
      const { fake, outputs, shield } = _setup()
      yield* shield.ensureSecurity({ ref: _ref, policy: _policy })
      yield* Ref.set(outputs, emptyCdnOutputs("stg"))
      const error = yield* Effect.flip(shield.ensureSecurity({ ref: _ref, policy: _policy }))
      assert.isTrue(error instanceof ResourceConflict)
      assert.strictEqual(fake.rateLimits().length, 1)
      assert.strictEqual(fake.customLists().length, 1)
    }))

  it.effect("never deletes a foreign list whose type differs", () =>
    Effect.gen(function*() {
      const { fake, outputs, shield } = _setup()
      yield* shield.ensureSecurity({ ref: _ref, policy: { ..._policy, rateLimits: [] } })
      yield* Ref.set(outputs, emptyCdnOutputs("stg"))

      const error = yield* Effect.flip(
        shield.ensureSecurity({
          ref: _ref,
          policy: { ..._policy, rateLimits: [], accessLists: [{ name: "office", type: "ip", action: "allow", entries: ["1.1.1.1"] }] }
        })
      )

      assert.isTrue(error instanceof ResourceConflict)
      assert.strictEqual(fake.customLists().length, 1)
    }))
})

describe("plan gating", () => {
  it.effect("fails naming the needed plan when rate limits exceed the zone limit", () =>
    Effect.gen(function*() {
      const { shield } = _setup()

      const rateLimits = Array.from({ length: 3 }, (_, index) => ({
        name: `r${index}`,
        pathPrefix: "/",
        requests: 5,
        window: "60",
        blockFor: "60",
        key: "ip" as const
      }))

      const exit = yield* Effect.exit(shield.ensureSecurity({ ref: _ref, policy: { plan: "basic", rateLimits, accessLists: [] } }))
      assert.isTrue(Exit.isFailure(exit))
      assert.include(_workaround(exit), "advanced")
    }))

  it.effect("fails when access lists exceed the list limit", () =>
    Effect.gen(function*() {
      const { shield } = _setup()
      const accessLists = ["a", "b"].map((name) => ({ name, type: "ip" as const, action: "block" as const, entries: ["1.1.1.1"] }))
      const exit = yield* Effect.exit(shield.ensureSecurity({ ref: _ref, policy: { plan: "basic", rateLimits: [], accessLists } }))
      assert.isTrue(Exit.isFailure(exit))
    }))

  it.effect("bot detection on the basic plan becomes CapabilityMissing naming a plan", () =>
    Effect.gen(function*() {
      const { shield } = _setup()

      const exit = yield* Effect.exit(
        shield.ensureSecurity({ ref: _ref, policy: { plan: "basic", botDetection: { mode: "log", sensitivity: "low" }, rateLimits: [], accessLists: [] } })
      )

      assert.isTrue(Exit.isFailure(exit))
      assert.include(_workaround(exit), "advanced")
    }))

  it.effect("rejects an unsupported rate limit window", () =>
    Effect.gen(function*() {
      const { shield } = _setup()

      const exit = yield* Effect.exit(
        shield.ensureSecurity({
          ref: _ref,
          policy: { ..._policy, rateLimits: [{ name: "x", pathPrefix: "/", requests: 1, window: "7", blockFor: "60", key: "ip" }] }
        })
      )

      assert.isTrue(Exit.isFailure(exit))
    }))
})

describe("resetSecurity", () => {
  it.effect("drops to basic, turns WAF and DDoS off and deletes owned rules and lists", () =>
    Effect.gen(function*() {
      const { fake, outputs, shield } = _setup()
      yield* shield.ensureSecurity({ ref: _ref, policy: _policy })
      yield* shield.resetSecurity(_ref)
      const zone = fake.zones()[0]
      assert.strictEqual(zone?.planType, 0)
      assert.strictEqual(zone?.wafEnabled, false)
      assert.strictEqual(zone?.dDoSShieldSensitivity, 0)
      assert.strictEqual(fake.rateLimits().length, 0)
      assert.strictEqual(fake.customLists().length, 0)
      const file = yield* Ref.get(outputs)
      assert.deepStrictEqual(file.rules, {})
      assert.deepStrictEqual(file.lists, {})
    }))

  it.effect("is a no-op when no shield zone exists", () =>
    Effect.gen(function*() {
      const { fake, shield } = _setup()
      yield* shield.resetSecurity(_ref)
      assert.strictEqual(fake.writes(), 0)
    }))
})
