// plain string substitution, not YAML round-trip: reserializing would reorder/reformat keys the user's tooling depends on
export interface ResolveServerUrlArgs {
  readonly lbVip?: string
  readonly apiDnsName?: string
  readonly masterIp: string
  readonly port?: number
}

export const resolveServerUrl = (args: ResolveServerUrlArgs): string => {
  const host = args.lbVip ?? args.apiDnsName ?? args.masterIp
  return `https://${host}:${args.port ?? 6443}`
}

export interface RewriteKubeconfigArgs {
  readonly content: string
  readonly clusterName: string
  readonly serverUrl: string
}

export const rewriteKubeconfig = (args: RewriteKubeconfigArgs): string =>
  args.content
    .replace(/server: https:\/\/\S+/, `server: ${args.serverUrl}`)
    .replace(/(name|cluster|user): default/g, `$1: ${args.clusterName}`)
    .replace(/current-context: default/, `current-context: ${args.clusterName}`)
