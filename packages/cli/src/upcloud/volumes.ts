import { Effect } from "effect"
import * as HttpClient from "effect/unstable/http/HttpClient"
import { makeK8sClient, parseKubeconfig, ResourceNotFound } from "@kumulo/core"
import type { K8sClient, K8sManifest, Kubeconfig, MksError, PlanAction, VolumeError, VolumeSpec } from "@kumulo/core"
import { mapUpcloudError } from "@kumulo/upcloud"
import { deleteVolume, ensureVolume, hasClusterLabel, listClusterVolumes, staticVolumeManifests } from "@kumulo/volumes-upcloud"
import type { VolumeProviderOptions } from "@kumulo/volumes-upcloud"
import type { UpcloudUksClusterConfig } from "../cluster-config.ts"
import { k8sHttpClientLayer } from "../k3s/k8s-http-client.ts"
import { UpcloudEnv } from "./env.ts"

export const uksVolumeRow = (name: string): string => `volume/${name}`

type ManagedVolume = Exclude<UpcloudUksClusterConfig["volumes"], { readonly module: "none" }>["managed"][number]

export const managedUpcloudVolumes = (config: UpcloudUksClusterConfig): ReadonlyArray<ManagedVolume> =>
  config.volumes.module === "none" ? [] : config.volumes.managed

const _toSpec = (entry: ManagedVolume): VolumeSpec => ({ name: entry.name, sizeGb: entry.size_gb, type: entry.type, retain: entry.retain })

export interface LiveVolume {
  readonly name: string
  readonly tier: string
}

// Tier is immutable at the API; a size-only change surfaces at apply, not as a plan-time Update row.
export const volumePlanActions = (
  { config, live }: { readonly config: UpcloudUksClusterConfig; readonly live: ReadonlyArray<LiveVolume> }
): ReadonlyArray<PlanAction> => {
  const liveByName = new Map(live.map((v) => [v.name, v]))
  return managedUpcloudVolumes(config).map((entry) => {
    const name = uksVolumeRow(entry.name)
    const match = liveByName.get(entry.name)
    if (match === undefined) return { _tag: "Create" as const, name }
    return match.tier === entry.type
      ? { _tag: "NoOp" as const, name }
      : { _tag: "ReplaceNeedsConfirm" as const, name, reason: `type: tier is immutable (${match.tier} -> ${entry.type})` }
  })
}

export const lookupUpcloudVolumes = (
  config: UpcloudUksClusterConfig
): Effect.Effect<ReadonlyArray<LiveVolume>, VolumeError, UpcloudEnv> =>
  Effect.gen(function*() {
    if (config.volumes.module !== "upcloud" || config.volumes.managed.length === 0) return []
    const { storage } = yield* UpcloudEnv
    const all = yield* mapUpcloudError({ self: storage.list(), ctx: { kind: "storage", ref: config.name } })
    return all.filter((s) => hasClusterLabel({ labels: s.labels, tag: config.name })).map((s) => ({ name: s.title, tier: s.tier ?? "unknown" }))
  })

const _options = (config: UpcloudUksClusterConfig): VolumeProviderOptions => ({ tag: config.name, zone: config.zone })

const _k8sClientFor = (
  kubeconfig: Kubeconfig
): Effect.Effect<K8sClient["Service"], MksError, HttpClient.HttpClient> =>
  Effect.gen(function*() {
    const parsed = yield* parseKubeconfig(kubeconfig.content).pipe(
      Effect.mapError((cause) => new ResourceNotFound({ kind: "kubeconfig", ref: cause.issues.map((i) => i.message).join(", ") }))
    )
    const client = yield* Effect.provide(HttpClient.HttpClient, k8sHttpClientLayer({ auth: parsed.auth, caPem: parsed.caPem }))
    return makeK8sClient({ client, server: parsed.server })
  })

const _isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null

const _metaField = (manifest: K8sManifest, key: "name" | "namespace"): string | undefined => {
  const meta = manifest["metadata"]
  if (!_isRecord(meta)) return undefined
  const value = meta[key]
  return typeof value === "string" ? value : undefined
}

const _refFor = (manifest: K8sManifest) => {
  const namespace = _metaField(manifest, "namespace")
  const name = _metaField(manifest, "name") ?? ""
  const plural = manifest.kind === "PersistentVolumeClaim" ? "persistentvolumeclaims" : "persistentvolumes"
  const path = namespace === undefined
    ? `/api/v1/${plural}/${name}`
    : `/api/v1/namespaces/${namespace}/${plural}/${name}`
  return { path, kind: manifest.kind }
}

const _applyManifests = (
  { k8sClient, manifests }: { readonly k8sClient: K8sClient["Service"]; readonly manifests: ReadonlyArray<K8sManifest> }
): Effect.Effect<void, MksError> =>
  Effect.forEach(manifests, (manifest) =>
    k8sClient.apply(_refFor(manifest), manifest).pipe(
      Effect.mapError((cause) => new ResourceNotFound({ kind: "k8s-manifest", ref: `${cause}` }))
    ), { discard: true })

export const convergeUpcloudVolumes = (
  { config, kubeconfig }: { readonly config: UpcloudUksClusterConfig; readonly kubeconfig: Kubeconfig }
): Effect.Effect<void, VolumeError | MksError, UpcloudEnv | HttpClient.HttpClient> =>
  Effect.gen(function*() {
    const managed = managedUpcloudVolumes(config)
    if (managed.length === 0) return
    const { storage } = yield* UpcloudEnv
    const options = _options(config)
    const k8sClient = yield* _k8sClientFor(kubeconfig)
    yield* Effect.forEach(managed, (entry) =>
      Effect.gen(function*() {
        const spec = _toSpec(entry)
        const info = yield* ensureVolume({ client: storage, options, spec })
        const pvc = entry.pvc === undefined ? undefined : { namespace: entry.pvc.namespace }
        yield* _applyManifests({ k8sClient, manifests: staticVolumeManifests({ vol: info, spec, pvc }) })
      }), { concurrency: 4 })
  })

export const reconcileUpcloudVolumesOnDelete = (
  config: UpcloudUksClusterConfig
): Effect.Effect<
  { readonly kept: ReadonlyArray<string>; readonly deleted: ReadonlyArray<string> },
  VolumeError,
  UpcloudEnv
> =>
  Effect.gen(function*() {
    const managed = managedUpcloudVolumes(config)
    if (managed.length === 0) return { kept: [], deleted: [] }
    const { storage } = yield* UpcloudEnv
    const existing = yield* listClusterVolumes({ client: storage, tag: config.name })
    const kept: Array<string> = []
    const deleted: Array<string> = []
    for (const entry of managed) {
      const vol = existing.find((v) => v.name === entry.name)
      if (vol === undefined) continue
      if (entry.retain) {
        kept.push(vol.name)
        continue
      }
      yield* deleteVolume({ client: storage, ref: { id: vol.id } })
      deleted.push(vol.name)
    }
    return { kept, deleted }
  })
