import { Effect } from "effect"
import type { K8sManifest } from "../domain/types.ts"
import { AddonInstallFailed } from "../errors/tagged.ts"
import type { K8sClient } from "./client.ts"
import { refFor } from "./resource-ref.ts"

export interface Addon {
  readonly name: string
  readonly manifests: ReadonlyArray<K8sManifest>
}

export type AddonError = AddonInstallFailed

// Applies each addon's manifests via K8sClient's server-side apply, one
// addon at a time in the caller-supplied (install) order — later addons may
// depend on resources created by earlier ones.
export interface InstallAddonsParams {
  readonly k8sClient: K8sClient["Service"]
  readonly addons: ReadonlyArray<Addon>
}

export const installAddons = ({ addons, k8sClient }: InstallAddonsParams): Effect.Effect<void, AddonError> =>
  Effect.forEach(addons, (addon) => _installOne({ addon, k8sClient }), { discard: true })

const _installOne = (
  { addon, k8sClient }: { readonly k8sClient: K8sClient["Service"]; readonly addon: Addon }
): Effect.Effect<void, AddonError> =>
  Effect.forEach(addon.manifests, (manifest) => k8sClient.apply(refFor(manifest), manifest), { discard: true }).pipe(
    Effect.mapError((cause) => new AddonInstallFailed({ addon: addon.name, cause: String(cause) }))
  )
