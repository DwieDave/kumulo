import { Effect } from "effect"
import { assert, it } from "@effect/vitest"
import { parseKubeVersion } from "../../src/distro/parse-kube-version.ts"

it.effect("a plain semver config version maps onto OVH's major.minor enum", () =>
  Effect.gen(function*() {
    assert.strictEqual(yield* parseKubeVersion("1.31.0"), "1.31")
    assert.strictEqual(yield* parseKubeVersion("v1.34.2"), "1.34")
  }))

it.effect("fails with a MksError (not a silent drop) when OVH doesn't support the requested minor", () =>
  Effect.gen(function*() {
    const failure = yield* parseKubeVersion("1.20.0").pipe(Effect.flip)
    assert.strictEqual(failure._tag, "ResourceConflict")
  }))
