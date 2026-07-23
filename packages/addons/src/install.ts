import { Addon, AddonInstallFailed } from "@kumulo/core"
import type { AddonContext, AddonError, K8sClient } from "@kumulo/core"
import { Effect } from "effect"
import { refFor } from "./resource-ref.ts"

export interface InstallAddonsParams {
  readonly k8sClient: K8sClient["Service"]
  readonly addons: ReadonlyArray<Addon["Service"]>
  readonly ctx: AddonContext
}

// Applies each addon's manifests via K8sClient's server-side apply, one
// addon at a time in the caller-supplied (install) order — later addons may
// depend on earlier ones existing (e.g. cinder-csi's StorageClass assumes
// the cloud-config Secret openstack-ccm/it already created).
export const installAddons = ({ addons, ctx, k8sClient }: InstallAddonsParams): Effect.Effect<void, AddonError> =>
  Effect.forEach(addons, (addon) => _installOne({ addon, ctx, k8sClient }), { discard: true })

interface InstallOneParams {
  readonly k8sClient: K8sClient["Service"]
  readonly addon: Addon["Service"]
  readonly ctx: AddonContext
}

const _installOne = ({ addon, ctx, k8sClient }: InstallOneParams): Effect.Effect<void, AddonError> =>
  addon.manifests(ctx).pipe(
    Effect.flatMap((manifests) =>
      Effect.forEach(manifests, (manifest) => k8sClient.apply(refFor(manifest), manifest), { discard: true })
    ),
    Effect.mapError((cause) => new AddonInstallFailed({ addon: addon.name, cause: String(cause) }))
  )
