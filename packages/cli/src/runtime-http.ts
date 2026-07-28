import * as NodeHttpClient from "@effect/platform-node/NodeHttpClient"
import type { Layer } from "effect"
import * as FetchHttpClient from "effect/unstable/http/FetchHttpClient"
import type * as HttpClient from "effect/unstable/http/HttpClient"

/**
 * Whether this process is Bun rather than Node.
 *
 * kumulo: `Bun` is a global Bun defines and Node does not — the same check
 * Bun's own docs give for runtime detection. Read through `globalThis` so the
 * absence is a plain `undefined` rather than a ReferenceError on Node.
 */
export const isBun = (): boolean => "Bun" in globalThis

/**
 * The platform's `HttpClient`.
 *
 * Node keeps undici (unchanged): it is what the shipped binary has always used
 * and what the CLI's HTTP behaviour is tuned against. Bun cannot run that layer
 * at all — `@effect/platform-node`'s undici client calls `dispatcher.destroy()`
 * on finalization, which Bun's undici shim does not implement, so every command
 * died with `TypeError: dispatcher.destroy is not a function` before its first
 * request completed.
 *
 * Bun gets `FetchHttpClient` instead — `fetch` is native there, needs no shim,
 * and is verified against the real UpCloud API on both runtimes.
 */
export const platformHttpClient = (): Layer.Layer<HttpClient.HttpClient> =>
  isBun() ? FetchHttpClient.layer : NodeHttpClient.layerUndici
