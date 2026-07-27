import type { Effect } from "effect";
import { Context } from "effect"
import type { AddonInstallFailed } from "../errors/tagged.ts"
import type { AddonContext, Capability, K8sManifest } from "../domain/types.ts"

export type AddonError = AddonInstallFailed

export class Addon extends Context.Service<Addon, {
  readonly name: string
  readonly requiredCapabilities: ReadonlyArray<Capability>
  readonly manifests: (ctx: AddonContext) => Effect.Effect<ReadonlyArray<K8sManifest>, AddonError>
}>()("@kumulo/core/Addon") {}
