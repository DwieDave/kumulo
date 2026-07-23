/** Placeholder export proving the package resolves; real implementation lands in later tasks. */
export const packageName = "@kumulo/distro-k3s"

export { cloudInitReady, controlPlaneReady, Ssh, SshCommandError, sshReady, SshLive } from "./ssh/index.ts"
export type { SshHost } from "./ssh/index.ts"
