import type { Effect } from "effect"
import type * as HttpClient from "effect/unstable/http/HttpClient"
import type { ClusterConfig, ConfigInvalid, DistroKind, Kubeconfig, MksError, Plan } from "@kumulo/core"
import type { CinderAuth } from "@kumulo/volumes-cinder"
import type { DoctorCheck } from "../doctor/types.ts"
import type { OpenStackEnv } from "../doctor-openstack/env.ts"
import type { K3sError } from "../k3s/reconcile.ts"
import type { MksEnv } from "../mks/env.ts"

// Widened env/error channels: every distro verb already runs under `MainLive`
// (see `main.ts`), so quantifying over the union costs nothing at runtime and
// is what lets the registry be a plain `Record<DistroKind, DistroEntry>`.
export type DistroServices = MksEnv | OpenStackEnv | CinderAuth | HttpClient.HttpClient
export type DistroFailure = MksError | K3sError | ConfigInvalid

export interface DistroApplyResult {
  /** The rendered "cluster is up" line, logged verbatim after apply. */
  readonly summary: string
}

export interface DistroEntry<C extends ClusterConfig = ClusterConfig> {
  readonly kind: DistroKind
  readonly supportsObjectStorage: boolean
  readonly plan: (config: C) => Effect.Effect<Plan, DistroFailure, DistroServices>
  readonly deletePlanActions: (
    config: C
  ) => Effect.Effect<Plan["actions"], DistroFailure, DistroServices>
  /** `replace`: node names the operator confirmed for replacement (never inferred by the distro). */
  readonly apply: (
    a: { readonly config: C; readonly configDir: string; readonly replace: ReadonlySet<string> }
  ) => Effect.Effect<DistroApplyResult, DistroFailure, DistroServices>
  readonly delete: (config: C) => Effect.Effect<void, DistroFailure, DistroServices>
  readonly kubeconfig: (config: C) => Effect.Effect<Kubeconfig, DistroFailure, DistroServices>
  /** Used by `delete`'s log line: `Deleted <deletedLabel>/<name>`. */
  readonly deletedLabel: string
  /** Plan-row name prefixes converged by `apply` itself (empty when apply logs nothing). */
  readonly appliedPrefixes: ReadonlyArray<string>
  readonly status: (config: C) => Effect.Effect<void, DistroFailure, DistroServices>
  readonly upgrade: (a: DistroUpgradeArgs<C>) => Effect.Effect<void, DistroFailure, DistroServices>
  /** How the credentials this distro reads are named in the env summary (`provider: ovh (ovh api)`). */
  readonly credentialsLabel: string
  /** Env vars this distro's own wiring reads — the env-summary source of truth. */
  readonly requiredEnvVars: ReadonlyArray<string>
  /**
   * The distro's doctor checks. An Effect because construction needs the
   * resolved env (`MksEnv`'s client, `OpenStackEnv`'s Keystone); both env
   * reads are never-failing, so the error channel stays `never`.
   */
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
