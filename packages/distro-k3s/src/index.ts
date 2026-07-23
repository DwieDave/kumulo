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
  resolveToken
} from "./bootstrap/index.ts"
export type {
  AddonDisableFlags,
  AgentInstallArgs,
  InstallMastersArgs,
  InstallWorkersArgs,
  NonEmptyMasters,
  ResolvedToken,
  ServerInstallArgs
} from "./bootstrap/index.ts"
