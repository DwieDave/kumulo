import { ConfigProvider, Effect, Redacted } from "effect"
import { assert, it } from "@effect/vitest"
import { requiredEnv, requiredRedactedEnv } from "../../src/mks/env.ts"

const _withEnv = (env: Record<string, string>) =>
  Effect.provideService(ConfigProvider.ConfigProvider, ConfigProvider.fromEnv({ env }))

it.effect("requiredEnv reads the var from Config when present", () =>
  Effect.gen(function*() {
    const value = yield* requiredEnv("OVH_CLIENT_ID").pipe(_withEnv({ OVH_CLIENT_ID: "app-1" }))
    assert.strictEqual(value, "app-1")
  }))

it.effect("requiredEnv fails with AuthenticationFailed naming the var when missing", () =>
  Effect.gen(function*() {
    const failure = yield* requiredEnv("OVH_CLIENT_ID").pipe(_withEnv({}), Effect.flip)
    assert.strictEqual(failure._tag, "AuthenticationFailed")
    assert.match(failure.hint, /OVH_CLIENT_ID/)
  }))

it.effect("requiredEnv fails on an empty-string var, same as missing", () =>
  Effect.gen(function*() {
    const failure = yield* requiredEnv("OVH_CLIENT_ID").pipe(_withEnv({ OVH_CLIENT_ID: "" }), Effect.flip)
    assert.strictEqual(failure._tag, "AuthenticationFailed")
  }))

it.effect("requiredRedactedEnv reads the var as Redacted", () =>
  Effect.gen(function*() {
    const value = yield* requiredRedactedEnv("OVH_CLIENT_SECRET").pipe(_withEnv({ OVH_CLIENT_SECRET: "s3cr3t" }))
    assert.strictEqual(Redacted.value(value), "s3cr3t")
    assert.notMatch(String(value), /s3cr3t/)
  }))

it.effect("requiredRedactedEnv fails with AuthenticationFailed naming the var when missing", () =>
  Effect.gen(function*() {
    const failure = yield* requiredRedactedEnv("OVH_CLIENT_SECRET").pipe(_withEnv({}), Effect.flip)
    assert.strictEqual(failure._tag, "AuthenticationFailed")
    assert.match(failure.hint, /OVH_CLIENT_SECRET/)
  }))
