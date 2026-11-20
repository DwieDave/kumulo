import { Context, Effect, Option, Redacted, Schema } from "effect"
import { HttpClient, HttpClientRequest } from "effect/http"
import type { ConfigInvalid } from "../errors/tagged.ts"
import { HttpTransportError, ResourceConflict, ResourceNotFound, ResponseDecodeError } from "../errors/tagged.ts"
import type { K8sManifest, Kubeconfig } from "../domain/types.ts"
import { parseKubeconfig } from "./kubeconfig.ts"
import type { KubeconfigContext } from "./kubeconfig.ts"

export interface ResourceRef {
  readonly path: string
  readonly kind: string
}

export class K8sClient extends Context.Service<K8sClient, {
  readonly get: (ref: ResourceRef) => Effect.Effect<K8sManifest, ResourceNotFound | HttpTransportError>
  readonly list: (ref: ResourceRef) => Effect.Effect<ReadonlyArray<K8sManifest>, HttpTransportError | ResponseDecodeError>
  readonly apply: (
    ref: ResourceRef,
    manifest: K8sManifest
  ) => Effect.Effect<K8sManifest, ResourceConflict | HttpTransportError>
  readonly delete: (ref: ResourceRef) => Effect.Effect<void, ResourceNotFound | HttpTransportError>
  // eviction is its own subresource POST, per the k8s Eviction API drain uses instead of a bare delete
  readonly evict: (
    namespace: string,
    pod: string
  ) => Effect.Effect<void, ResourceNotFound | ResourceConflict | HttpTransportError>
}>()("@kumulo/core/K8sClient") {}

const _transportError = (cause: unknown): HttpTransportError => new HttpTransportError({ cause })

const _statusError = (ref: ResourceRef, status: number): ResourceNotFound | HttpTransportError =>
  status === 404 ? new ResourceNotFound({ kind: ref.kind, ref: ref.path }) : _transportError(`status ${status}`)

const K8sManifestSchema = Schema.StructWithRest(
  Schema.Struct({ apiVersion: Schema.String, kind: Schema.String }),
  [Schema.Record(Schema.String, Schema.Json)]
)

const K8sListSchema = Schema.Struct({
  items: Schema.optional(Schema.Array(Schema.Unknown))
})

export interface K8sClientOptions {
  readonly client: HttpClient.HttpClient
  readonly server: string
}

const _url = (server: string, path: string): URL => new URL(path, server)

const _decodeManifest = Schema.decodeUnknownEffect(K8sManifestSchema)

const _manifestError = () => _transportError("response body was not a K8s manifest")

export const makeK8sClient = (options: K8sClientOptions): K8sClient["Service"] => {
  const { client, server } = options

  const get: K8sClient["Service"]["get"] = (ref) =>
    Effect.gen(function*() {
      const response = yield* client.execute(HttpClientRequest.get(_url(server, ref.path))).pipe(
        Effect.mapError(_transportError)
      )

      if (response.status !== 200) return yield* Effect.fail(_statusError(ref, response.status))
      const body = yield* response.json.pipe(Effect.mapError(_transportError))

      return yield* _decodeManifest(body).pipe(Effect.mapError(_manifestError))
    })

  const list: K8sClient["Service"]["list"] = (ref) =>
    Effect.gen(function*() {
      const response = yield* client.execute(HttpClientRequest.get(_url(server, ref.path))).pipe(
        Effect.mapError(_transportError)
      )

      if (response.status !== 200) return yield* Effect.fail(_transportError(`status ${response.status}`))
      const body = yield* response.json.pipe(Effect.mapError(_transportError))

      // an undecodable list must fail: treating it as empty would let drain delete a node that still has pods
      const listing = yield* Schema.decodeUnknownEffect(K8sListSchema)(body).pipe(
        Effect.mapError((error) => new ResponseDecodeError({ endpoint: ref.path, issue: error.issue }))
      )

      const decoded = yield* Effect.forEach(listing.items ?? [], (item) => Effect.option(_decodeManifest(item)))

      return decoded.flatMap(Option.toArray)
    })

  // server-side apply with force=true — last writer wins on field-manager conflict, kumulo owns these resources wholesale
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

      return yield* _decodeManifest(body).pipe(Effect.mapError(_manifestError))
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


export interface K8sClientFromKubeconfigOptions<E, R> {
  readonly kubeconfig: Kubeconfig
  // Builds the transport for the parsed context. Core has no TLS dependency, so the caller
  // applies the CA and client-cert material here; the bearer token is added by the builder.
  readonly httpClientFor: (context: KubeconfigContext) => Effect.Effect<HttpClient.HttpClient, E, R>
}

// Parse a kubeconfig and build a `K8sClient` for its server: the shared replacement for the per-call-site copies in the CLI.
export const k8sClientFromKubeconfig = <E, R>(
  options: K8sClientFromKubeconfigOptions<E, R>
): Effect.Effect<K8sClient["Service"], ConfigInvalid | E, R> =>
  Effect.gen(function*() {
    const context = yield* parseKubeconfig(options.kubeconfig.content)
    const base = yield* options.httpClientFor(context)

    const client = context.auth.kind === "token"
      ? HttpClient.mapRequest(base, HttpClientRequest.bearerToken(Redacted.value(context.auth.token)))
      : base

    return makeK8sClient({ client, server: context.server })
  })

const _toYaml = (manifest: K8sManifest): string => JSON.stringify(manifest)
