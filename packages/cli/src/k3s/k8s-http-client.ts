import { Layer } from "effect"
import * as BunHttpClient from "@effect/platform-bun/BunHttpClient"
import type * as HttpClient from "effect/unstable/http/HttpClient"
import type { KubeconfigAuth } from "@kumulo/core"

// An authenticated `HttpClient` for the freshly-bootstrapped
// cluster (k3s's own client-cert kubeconfig, or a bearer token if some
// future distro's kubeconfig uses one). `FetchHttpClient.RequestInit` (bare
// re-exported through `BunHttpClient`) is the documented hook for default
// fetch options — Bun's fetch accepts `tls: { cert, key, ca }` directly, so
// no bespoke HttpClient constructor is needed.
// ponytail: `rejectUnauthorized` isn't threaded through when `caPem` is
// absent — every k3s kubeconfig carries one, so this only matters for a
// malformed kubeconfig, which the Addons phase would fail on anyway.
// kumulo: WHY a bespoke interface — Bun's `fetch` accepts a `tls` option
// that the (Node/Web-shaped) `RequestInit` type this package's `tsconfig`
// resolves against doesn't declare; widening the type here (not casting)
// keeps `kumulo/no-type-assertion` satisfied.
interface BunRequestInit extends globalThis.RequestInit {
  readonly tls?: { readonly cert: string; readonly key: string; readonly ca: string | undefined }
}

const _requestInit = (
  { auth, caPem }: { readonly auth: KubeconfigAuth; readonly caPem: string | undefined }
): BunRequestInit =>
  auth.kind === "token"
    ? { headers: { authorization: `Bearer ${auth.token}` } }
    : { tls: { cert: auth.certPem, key: auth.keyPem, ca: caPem } }

export const k8sHttpClientLayer = (
  { auth, caPem }: { readonly auth: KubeconfigAuth; readonly caPem?: string }
): Layer.Layer<HttpClient.HttpClient> =>
  BunHttpClient.layer.pipe(
    Layer.provide(Layer.succeed(BunHttpClient.RequestInit, _requestInit({ auth, caPem })))
  )
