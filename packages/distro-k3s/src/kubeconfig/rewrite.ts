// FR-5.5 — kubeconfig fetched from k3s is a single-context YAML with
// `server: https://127.0.0.1:6443` and cluster/context/user all named
// "default" (k3s's fixed template). Rewriting is plain string substitution,
// not a YAML round-trip — reserializing risks reordering/reformatting keys
// the user's kubectl/tooling doesn't care about; only these fixed tokens change.

export interface ResolveServerUrlArgs {
  readonly lbVip?: string
  readonly apiDnsName?: string
  readonly masterIp: string
  readonly port?: number
}

// FR-5.5 precedence: LB VIP > DNS api name > master IP.
export const resolveServerUrl = (args: ResolveServerUrlArgs): string => {
  const host = args.lbVip ?? args.apiDnsName ?? args.masterIp
  return `https://${host}:${args.port ?? 6443}`
}

export interface RewriteKubeconfigArgs {
  readonly content: string
  readonly clusterName: string
  readonly serverUrl: string
}

/** Rewrite k3s's default-named single-context kubeconfig for a real cluster name/endpoint. FR-5.5. */
export const rewriteKubeconfig = (args: RewriteKubeconfigArgs): string =>
  args.content
    .replace(/server: https:\/\/\S+/, `server: ${args.serverUrl}`)
    .replace(/(name|cluster|user): default/g, `$1: ${args.clusterName}`)
    .replace(/current-context: default/, `current-context: ${args.clusterName}`)
