import type { Effect } from "effect"
import type { FileSystem } from "effect/FileSystem"
import type { PlatformError } from "effect/PlatformError"
import type * as HttpClient from "effect/unstable/http/HttpClient"
import type { ChildProcessSpawner as ChildProcessSpawnerNS } from "effect/unstable/process"
import type { BucketNotEmpty, ConfigInvalid, CredentialsSinkError, DistroKind, Kubeconfig, MksError, Plan } from "@kumulo/core"
import type { ClusterConfig } from "../cluster-config.ts"
import type { CinderAuth, OutputsIngress } from "@kumulo/volumes-cinder"
import type { DoctorCheck } from "../doctor/types.ts"
import type { OpenStackEnv } from "../doctor-openstack/env.ts"
import type { K3sError } from "../k3s/reconcile.ts"
import type { MksEnv } from "../mks/env.ts"
import type { UpcloudEnv } from "../upcloud/env.ts"

export type DistroServices =
  | MksEnv
  | OpenStackEnv
  | CinderAuth
  | HttpClient.HttpClient
  | UpcloudEnv
  | FileSystem
  | ChildProcessSpawnerNS.ChildProcessSpawner
export type DistroFailure = MksError | K3sError | ConfigInvalid | BucketNotEmpty | CredentialsSinkError | PlatformError

export interface DistroApplyResult {
  readonly summary: string
  readonly ingress?: OutputsIngress
}

export interface DistroEntry<C extends ClusterConfig = ClusterConfig> {
  readonly kind: DistroKind
  readonly supportsObjectStorage: boolean
  readonly plan: (config: C) => Effect.Effect<Plan, DistroFailure, DistroServices>
  readonly deletePlanActions: (
    config: C
  ) => Effect.Effect<Plan["actions"], DistroFailure, DistroServices>
  // replace: node names the operator confirmed for replacement (never inferred by the distro)
  readonly apply: (
    a: { readonly config: C; readonly configDir: string; readonly replace: ReadonlySet<string> }
  ) => Effect.Effect<DistroApplyResult, DistroFailure, DistroServices>
  readonly delete: (config: C) => Effect.Effect<void, DistroFailure, DistroServices>
  readonly kubeconfig: (config: C) => Effect.Effect<Kubeconfig, DistroFailure, DistroServices>
  readonly deletedLabel: string
  readonly appliedPrefixes: ReadonlyArray<string>
  readonly selfProgress?: boolean
  readonly status: (config: C) => Effect.Effect<void, DistroFailure, DistroServices>
  readonly upgrade: (a: DistroUpgradeArgs<C>) => Effect.Effect<void, DistroFailure, DistroServices>
  readonly credentialsLabel: string
  readonly requiredEnvVars: ReadonlyArray<string>
  readonly doctorChecks: (
    a: { readonly config: C }
  ) => Effect.Effect<ReadonlyArray<DoctorCheck>, never, DistroServices>
}

export interface DistroUpgradeArgs<C extends ClusterConfig = ClusterConfig> {
  readonly config: C
  readonly strategy: "LATEST_PATCH" | "NEXT_MINOR"
  readonly workerConcurrency: number
  readonly yes: boolean
  readonly dryRun: boolean
}
