import * as NodeHttpClient from "@effect/platform-node/NodeHttpClient"
import type { Layer } from "effect"
import * as FetchHttpClient from "effect/unstable/http/FetchHttpClient"
import type * as HttpClient from "effect/unstable/http/HttpClient"

export const isBun = (): boolean => "Bun" in globalThis

// Bun's undici shim lacks dispatcher.destroy(), which @effect/platform-node's undici client calls on finalization — use FetchHttpClient on Bun.
export const platformHttpClient = (): Layer.Layer<HttpClient.HttpClient> =>
  isBun() ? FetchHttpClient.layer : NodeHttpClient.layerUndici
