import { Context, Effect, Option, Schema } from "effect"
import { HttpClient, HttpClientRequest } from "effect/unstable/http"
import { HttpTransportError, ResourceConflict, ResourceNotFound } from "../errors/tagged.ts"
import type { K8sManifest } from "../domain/types.ts"

export interface ResourceRef {
  // kumulo: caller supplies the full REST path (e.g. "/api/v1/nodes/foo",
  // "/apis/apps/v1/namespaces/default/deployments/bar") — a GVK->path
  // mapper is unneeded complexity when every caller already knows its own
  // resource's path (distro-k3s, addons, cli status all target fixed kinds).
  readonly path: string
  readonly kind: string
}

export class K8sClient extends Context.Service<K8sClient, {
  readonly get: (ref: ResourceRef) => Effect.Effect<K8sManifest, ResourceNotFound | HttpTransportError>
  readonly list: (ref: ResourceRef) => Effect.Effect<ReadonlyArray<K8sManifest>, HttpTransportError>
  readonly apply: (
    ref: ResourceRef,
    manifest: K8sManifest
  ) => Effect.Effect<K8sManifest, ResourceConflict | HttpTransportError>
  readonly delete: (ref: ResourceRef) => Effect.Effect<void, ResourceNotFound | HttpTransportError>
  // kumulo: eviction is its own subresource POST (not a generic PATCH/DELETE),
  // per the Eviction API k8s drain uses instead of a bare pod delete.
  readonly evict: (
    namespace: string,
    pod: string
  ) => Effect.Effect<void, ResourceNotFound | ResourceConflict | HttpTransportError>
}>()("@kumulo/core/K8sClient") {}

const _transportError = (cause: unknown): HttpTransportError => new HttpTransportError({ cause })

const _statusError = (ref: ResourceRef, status: number): ResourceNotFound | HttpTransportError =>
  status === 404 ? new ResourceNotFound({ kind: ref.kind, ref: ref.path }) : _transportError(`status ${status}`)

// kumulo: lenient decode (FR-4.6) — apiVersion/kind are the only fields any
// caller relies on structurally; every other field is passed through
// untouched via the trailing `Record` so node-ops/addons/readiness can read
// arbitrary manifest fields (metadata, status, spec) without a schema per
// resource kind.
const K8sManifestSchema = Schema.StructWithRest(
  Schema.Struct({ apiVersion: Schema.String, kind: Schema.String }),
  [Schema.Record(Schema.String, Schema.Unknown)]
)

const K8sListSchema = Schema.Struct({
  items: Schema.optional(Schema.Array(Schema.Unknown))
})
const _emptyListing: { items?: ReadonlyArray<unknown> } = { items: [] }

export interface K8sClientOptions {
  // kumulo: `client` is expected to already be authenticated (bearer token
  // header, or an https.Agent carrying client-cert material) — building
  // that from a parsed `KubeconfigContext` is the composition root's job
  // (platform-specific TLS Agent wiring isn't reachable from core, see
  // dep-lint's core-only-imports-effect rule).
  readonly client: HttpClient.HttpClient
  readonly server: string
}

const _url = (server: string, path: string): URL => new URL(path, server)

// kumulo: `undefined` on a malformed body (missing apiVersion/kind) signals
// "not a manifest" to callers, who turn that into a tagged error.
const _decodeManifest = (
  body: unknown
): Effect.Effect<K8sManifest, HttpTransportError> =>
  Schema.decodeUnknownEffect(K8sManifestSchema)(body).pipe(
    Effect.mapError(() => _transportError("response body was not a K8s manifest"))
  )

const _decodeManifestOption = (item: unknown): Effect.Effect<Option.Option<K8sManifest>> =>
  Schema.decodeUnknownEffect(K8sManifestSchema)(item).pipe(Effect.option)

export const makeK8sClient = (options: K8sClientOptions): K8sClient["Service"] => {
  const { client, server } = options

  const get: K8sClient["Service"]["get"] = (ref) =>
    Effect.gen(function*() {
      const response = yield* client.execute(HttpClientRequest.get(_url(server, ref.path))).pipe(
        Effect.mapError(_transportError)
      )
      if (response.status !== 200) return yield* Effect.fail(_statusError(ref, response.status))
      const body = yield* response.json.pipe(Effect.mapError(_transportError))
      return yield* _decodeManifest(body)
    })

  const list: K8sClient["Service"]["list"] = (ref) =>
    Effect.gen(function*() {
      const response = yield* client.execute(HttpClientRequest.get(_url(server, ref.path))).pipe(
        Effect.mapError(_transportError)
      )
      if (response.status !== 200) return yield* Effect.fail(_transportError(`status ${response.status}`))
      const body = yield* response.json.pipe(Effect.mapError(_transportError))
      // kumulo: a body with no/malformed `items` yields an empty list rather
      // than a transport error — same lenient "not a manifest -> skip it"
      // semantics as `_decodeManifest`, just per-item instead of whole-body.
      const listing = yield* Schema.decodeUnknownEffect(K8sListSchema)(body).pipe(
        Effect.orElseSucceed(() => _emptyListing)
      )
      const decoded = yield* Effect.forEach(listing.items ?? [], _decodeManifestOption)
      return decoded.flatMap(Option.toArray)
    })

  // kumulo: server-side apply per FR-9.2 — PATCH with
  // application/apply-patch+yaml, fieldManager=kumulo, force=true (last
  // writer wins on field-manager conflict, since kumulo owns these
  // resources wholesale, no shared ownership to negotiate).
  const apply: K8sClient["Service"]["apply"] = (ref, manifest) =>
    Effect.gen(function*() {
      const request = HttpClientRequest.patch(_url(server, `${ref.path}?fieldManager=kumulo&force=true`)).pipe(
        HttpClientRequest.bodyText(_toYaml(manifest), "application/apply-patch+yaml")
      )
      const response = yield* client.execute(request).pipe(Effect.mapError(_transportError))
      if (response.status === 409) return yield* Effect.fail(new ResourceConflict({ kind: ref.kind, ref: ref.path }))
      if (response.status !== 200 && response.status !== 201) {
        return yield* Effect.fail(_transportError(`status ${response.status}`))
      }
      const body = yield* response.json.pipe(Effect.mapError(_transportError))
      return yield* _decodeManifest(body)
    })

  const deleteResource: K8sClient["Service"]["delete"] = (ref) =>
    client.execute(HttpClientRequest.delete(_url(server, ref.path))).pipe(
      Effect.mapError(_transportError),
      Effect.flatMap((response) =>
        response.status === 200 || response.status === 202 || response.status === 404
          ? Effect.void
          : Effect.fail(_statusError(ref, response.status))
      )
    )

  const evict: K8sClient["Service"]["evict"] = (namespace, pod) =>
    Effect.gen(function*() {
      const path = `/api/v1/namespaces/${namespace}/pods/${pod}/eviction`
      const body = { apiVersion: "policy/v1", kind: "Eviction", metadata: { name: pod, namespace } }
      const request = HttpClientRequest.post(_url(server, path)).pipe(
        HttpClientRequest.bodyText(JSON.stringify(body), "application/json")
      )
      const response = yield* client.execute(request).pipe(Effect.mapError(_transportError))
      if (response.status === 200 || response.status === 201) return
      if (response.status === 404) return yield* Effect.fail(new ResourceNotFound({ kind: "Pod", ref: path }))
      if (response.status === 409) return yield* Effect.fail(new ResourceConflict({ kind: "Pod", ref: path }))
      return yield* Effect.fail(_transportError(`status ${response.status}`))
    })

  return { get, list, apply, delete: deleteResource, evict }
}

// kumulo: manifests are plain JSON-compatible objects, and YAML is a
// superset of JSON — sending `JSON.stringify` output as the apply-patch
// body avoids pulling the `yaml` stringifier through a hot path for no
// behavioral difference.
const _toYaml = (manifest: K8sManifest): string => JSON.stringify(manifest)
