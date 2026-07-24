/** Placeholder export proving the package resolves; real implementation lands in later tasks. */
export const packageName = "@kumulo/distro-k3s"

export { cloudInitReady, controlPlaneReady, Ssh, SshCommandError, sshReady, SshLive } from "./ssh/index.ts"
export type { SshHost } from "./ssh/index.ts"

export { renderCloudInit } from "./cloudinit/index.ts"
export type { CloudInitArgs } from "./cloudinit/index.ts"

export {
  installMasters,
  installWorkers,
  renderAgentInstallScript,
  renderServerInstallScript,
  resolveToken,
  runBootstrap
} from "./bootstrap/index.ts"
export type {
  AddonDisableFlags,
  AgentInstallArgs,
  BootstrapResult,
  InstallMastersArgs,
  InstallWorkersArgs,
  NonEmptyMasters,
  ResolvedToken,
  RunBootstrapArgs,
  ServerInstallArgs
} from "./bootstrap/index.ts"

export { fetchKubeconfig, resolveServerUrl, rewriteKubeconfig, writeKubeconfigFile } from "./kubeconfig/index.ts"
export type { FetchKubeconfigArgs, ResolveServerUrlArgs, RewriteKubeconfigArgs } from "./kubeconfig/index.ts"

export { K3S_RELEASE_FIXTURE, makeReleaseCache } from "./releases/index.ts"
export type { MakeReleaseCacheArgs, ReleaseCache } from "./releases/index.ts"

export { bootstrapOrder, drainAndRemove, makeSelfManagedDistro } from "./distro/index.ts"
export type { MakeSelfManagedDistroArgs } from "./distro/index.ts"

export { renderMastersPlan, renderUpgradePlan, renderWorkersPlan } from "./upgrade/index.ts"
export type { UpgradePlanArgs, WorkersPlanArgs } from "./upgrade/index.ts"
