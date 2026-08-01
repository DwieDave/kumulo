// every config-derived value goes through shellQuote; extra*Args stay raw as verbatim k3s flags
import { shellQuote } from "../ssh/shell.ts"

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
  Array.from(new Set(["127.0.0.1", ...sans])).map((san) => `--tls-san=${shellQuote(san)}`).join(" ")

const _cniDisableArgs = (cni: "flannel" | "cilium"): string =>
  cni === "cilium" ? "--flannel-backend=none --disable-network-policy" : ""

const _labelArgs = (labels: Readonly<Record<string, string>>): string =>
  Object.entries(labels).map(([key, value]) => `--node-label ${shellQuote(`${key}=${value}`)}`).join(" ")

const _taintArgs = (taints: ReadonlyArray<string>): string => taints.map((taint) => `--node-taint ${shellQuote(taint)}`).join(" ")

export const renderServerInstallScript = (args: ServerInstallArgs): string => {
  const server = args.isFirstMaster ? "--cluster-init" : `--server https://${args.firstMasterIp}:6443`
  const disableCcm = args.addons.cloudControllerManager ? "" : "--disable-cloud-controller"

  return `#!/bin/bash
set -euo pipefail

curl -sfL https://get.k3s.io | \\
  INSTALL_K3S_VERSION=${shellQuote(args.k3sVersion)} \\
  K3S_TOKEN=${shellQuote(args.token)} \\
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

export const renderAgentInstallScript = (args: AgentInstallArgs): string =>
  `#!/bin/bash
set -euo pipefail

curl -sfL https://get.k3s.io | \\
  INSTALL_K3S_VERSION=${shellQuote(args.k3sVersion)} \\
  K3S_TOKEN=${shellQuote(args.token)} \\
  K3S_URL="https://${args.firstMasterIp}:6443" \\
  INSTALL_K3S_EXEC="agent" \\
  sh -s - \\
    --node-ip=${args.privateIp} \\
    --node-external-ip=${args.publicIp} \\
    ${_labelArgs(args.nodeLabels)} \\
    ${_taintArgs(args.nodeTaints)} \\
    ${args.extraAgentArgs.join(" ")}
`
