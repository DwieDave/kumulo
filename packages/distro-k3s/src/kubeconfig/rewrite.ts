// kumulo: WHY plain string substitution, not a YAML round-trip — kubeconfig
// fetched from k3s is a single-context YAML with `server:
// https://127.0.0.1:6443` and cluster/context/user all named "default"
// (k3s's fixed template); reserializing risks reordering/reformatting keys
// the user's kubectl/tooling doesn't care about, so only these fixed tokens change.

export interface ResolveServerUrlArgs {
  readonly lbVip?: string
  readonly apiDnsName?: string
  readonly masterIp: string
  readonly port?: number
}

// Precedence: LB VIP > DNS api name > master IP.
export const resolveServerUrl = (args: ResolveServerUrlArgs): string => {
  const host = args.lbVip ?? args.apiDnsName ?? args.masterIp
  return `https://${host}:${args.port ?? 6443}`
}

export interface RewriteKubeconfigArgs {
  readonly content: string
  readonly clusterName: string
  readonly serverUrl: string
}

/** Rewrite k3s's default-named single-context kubeconfig for a real cluster name/endpoint. */
export const rewriteKubeconfig = (args: RewriteKubeconfigArgs): string =>
  args.content
    .replace(/server: https:\/\/\S+/, `server: ${args.serverUrl}`)
    .replace(/(name|cluster|user): default/g, `$1: ${args.clusterName}`)
    .replace(/current-context: default/, `current-context: ${args.clusterName}`)
