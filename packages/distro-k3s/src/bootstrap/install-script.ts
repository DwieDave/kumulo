// k3s install-over-SSH scripts, plain string interpolation — no template
// engine dependency needed for a handful of substitutions.

export interface AddonDisableFlags {
  readonly cloudControllerManager: boolean
  readonly cni: "flannel" | "cilium"
}

export interface ServerInstallArgs {
  readonly k3sVersion: string
  readonly token: string
  readonly isFirstMaster: boolean
  readonly firstMasterIp: string
  readonly privateIp: string
  readonly publicIp: string
  readonly tlsSans: ReadonlyArray<string>
  readonly addons: AddonDisableFlags
  readonly extraServerArgs: ReadonlyArray<string>
}

export interface AgentInstallArgs {
  readonly k3sVersion: string
  readonly token: string
  readonly firstMasterIp: string
  readonly privateIp: string
  readonly publicIp: string
  readonly nodeLabels: Readonly<Record<string, string>>
  readonly nodeTaints: ReadonlyArray<string>
  readonly extraAgentArgs: ReadonlyArray<string>
}

const _tlsSanArgs = (sans: ReadonlyArray<string>): string =>
  Array.from(new Set(["127.0.0.1", ...sans])).map((san) => `--tls-san=${san}`).join(" ")

const _cniDisableArgs = (cni: "flannel" | "cilium"): string =>
  cni === "cilium" ? "--flannel-backend=none --disable-network-policy" : ""

const _labelArgs = (labels: Readonly<Record<string, string>>): string =>
  Object.entries(labels).map(([key, value]) => `--node-label "${key}=${value}"`).join(" ")

const _taintArgs = (taints: ReadonlyArray<string>): string => taints.map((taint) => `--node-taint "${taint}"`).join(" ")

/** Render the k3s server-node install script (`--cluster-init` or `--server` join). */
export const renderServerInstallScript = (args: ServerInstallArgs): string => {
  const server = args.isFirstMaster ? "--cluster-init" : `--server https://${args.firstMasterIp}:6443`
  const disableCcm = args.addons.cloudControllerManager ? "" : "--disable-cloud-controller"

  return `#!/bin/bash
set -euo pipefail

curl -sfL https://get.k3s.io | \\
  INSTALL_K3S_VERSION="${args.k3sVersion}" \\
  K3S_TOKEN="${args.token}" \\
  INSTALL_K3S_EXEC="server" \\
  sh -s - \\
    ${server} \\
    ${disableCcm} \\
    --write-kubeconfig-mode=644 \\
    --advertise-address=${args.privateIp} \\
    --node-ip=${args.privateIp} \\
    --node-external-ip=${args.publicIp} \\
    ${_tlsSanArgs(args.tlsSans)} \\
    ${_cniDisableArgs(args.addons.cni)} \\
    ${args.extraServerArgs.join(" ")}
`
}

/** Render the k3s agent-node install script (join via master 1). */
export const renderAgentInstallScript = (args: AgentInstallArgs): string =>
  `#!/bin/bash
set -euo pipefail

curl -sfL https://get.k3s.io | \\
  INSTALL_K3S_VERSION="${args.k3sVersion}" \\
  K3S_TOKEN="${args.token}" \\
  K3S_URL="https://${args.firstMasterIp}:6443" \\
  INSTALL_K3S_EXEC="agent" \\
  sh -s - \\
    --node-ip=${args.privateIp} \\
    --node-external-ip=${args.publicIp} \\
    ${_labelArgs(args.nodeLabels)} \\
    ${_taintArgs(args.nodeTaints)} \\
    ${args.extraAgentArgs.join(" ")}
`
