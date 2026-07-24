import { Effect, Schema } from "effect"
import { ResourceConflict } from "@kumulo/core"
import type { MksError } from "@kumulo/core"
import { Cloud_kube_VersionEnum } from "../generated/client.ts"
import type { Cloud_kube_VersionEnum as Cloud_kube_VersionEnumType } from "../generated/client.ts"

// kumulo: `ClusterConfig.version` is a plain semver (`vN.N.N`/`N.N.N`);
// OVH's MKS enum only carries major.minor (`"1.31"`, no patch).
// Strip an optional leading `v` and the patch component, then validate
// against the generated enum's own `Schema` — an unsupported minor fails
// loudly with a real `MksError` instead of silently omitting `version` and
// letting OVH pick whatever it defaults to.
const _majorMinor = (version: string): string => version.replace(/^v/, "").split(".").slice(0, 2).join(".")

export const parseKubeVersion = (version: string): Effect.Effect<Cloud_kube_VersionEnumType, MksError> =>
  Schema.decodeUnknownEffect(Cloud_kube_VersionEnum)(_majorMinor(version)).pipe(
    Effect.mapError(() =>
      new ResourceConflict({ kind: "kube-version", ref: `${version} is not an OVH-supported Kubernetes version` })
    )
  )
