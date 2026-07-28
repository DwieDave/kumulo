import { Effect } from "effect"
import { assert, it } from "@effect/vitest"
import * as NodeHttpClient from "@effect/platform-node/NodeHttpClient"
import * as FetchHttpClient from "effect/unstable/http/FetchHttpClient"
import * as HttpClient from "effect/unstable/http/HttpClient"
import { isBun, platformHttpClient } from "../src/runtime-http.ts"

// The CLI ran node-only until the undici layer turned out to be the single
// reason: `@effect/platform-node`'s client calls `dispatcher.destroy()` on
// finalization, which Bun does not implement, so every command died before its
// first request finished. These tests pin the selection so a future edit cannot
// quietly put undici back on both runtimes.

it("builds an HttpClient on whichever runtime the suite is running under", () =>
  Effect.runPromise(
    Effect.gen(function*() {
      const client = yield* HttpClient.HttpClient
      assert.isFunction(client.execute)
    }).pipe(Effect.provide(platformHttpClient()))
  ))

it("detects the runtime from the Bun global, not from a thrown ReferenceError", () => {
  assert.strictEqual(isBun(), "Bun" in globalThis)
})

it("picks fetch on Bun and undici on Node, by layer identity", () => {
  assert.strictEqual(platformHttpClient(), isBun() ? FetchHttpClient.layer : NodeHttpClient.layerUndici)
})

it("never hands Bun the undici layer", () => {
  // The assertion that actually encodes the bug: whatever the current runtime
  // is, the Bun branch must not resolve to undici.
  assert.notStrictEqual(FetchHttpClient.layer, NodeHttpClient.layerUndici)
  assert.isFalse(isBun() && platformHttpClient() === NodeHttpClient.layerUndici)
})
