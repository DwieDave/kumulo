import { Effect, Layer } from "effect"
import * as NodeHttpClient from "@effect/platform-node/NodeHttpClient"
import * as HttpClient from "effect/unstable/http/HttpClient"
import * as HttpClientRequest from "effect/unstable/http/HttpClientRequest"
import type { KubeconfigAuth } from "@kumulo/core"

// An authenticated `HttpClient` for the freshly-bootstrapped cluster (k3s's own
// client-cert kubeconfig, or a bearer token if some future distro's kubeconfig
// uses one). The node:http client takes an `https.Agent`, which accepts
// `cert`/`key`/`ca` directly — no bespoke HttpClient constructor needed.
//
// The kubeconfig CA is passed in BOTH auth modes: a k3s API server presents a
// self-signed cert, so the default trust store would reject it for a token
// kubeconfig too.
const _agentOptions = (
  { auth, caPem }: { readonly auth: KubeconfigAuth; readonly caPem: string | undefined }
) =>
  auth.kind === "token"
    ? { ca: caPem }
    : { cert: auth.certPem, key: auth.keyPem, ca: caPem }

const _withBearer = (token: string): Layer.Layer<HttpClient.HttpClient, never, HttpClient.HttpClient> =>
  Layer.effect(HttpClient.HttpClient)(
    Effect.map(
      Effect.service(HttpClient.HttpClient),
      HttpClient.mapRequest(HttpClientRequest.bearerToken(token))
    )
  )

export const k8sHttpClientLayer = (
  { auth, caPem }: { readonly auth: KubeconfigAuth; readonly caPem?: string }
): Layer.Layer<HttpClient.HttpClient> => {
  const base = NodeHttpClient.layerNodeHttpNoAgent.pipe(
    Layer.provide(NodeHttpClient.layerAgentOptions(_agentOptions({ auth, caPem })))
  )
  return auth.kind === "token" ? _withBearer(auth.token).pipe(Layer.provide(base)) : base
}
