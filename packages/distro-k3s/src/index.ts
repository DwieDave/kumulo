/** @kumulo/distro-k3s — package barrel. */
export const packageName = "@kumulo/distro-k3s"

export { ciliumAddon } from "./addons/cilium.ts"

export { systemUpgradeControllerAddon } from "./addons/system-upgrade-controller.ts"

export { K3sClusterConfig } from "./config.ts"

export type { K3sClusterConfigEncoded } from "./config.ts"

export { cloudInitReady, controlPlaneReady, Ssh, SshCommandError, SshHostKeyMismatch, sshReady, SshLive, makeSshLive } from "./ssh/index.ts"

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

export { bootstrapOrder, drainAndRemove, renderUserData } from "./distro/index.ts"

export type { RenderUserDataArgs } from "./distro/index.ts"

export { refForPlan, renderMastersPlan, renderUpgradePlan, renderWorkersPlan } from "./upgrade/index.ts"

export type { UpgradePlanArgs, WorkersPlanArgs } from "./upgrade/index.ts"
