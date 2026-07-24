import { Effect } from "effect"
import { BootstrapFailed } from "@kumulo/core"
import type { Kubeconfig } from "@kumulo/core"
import { Ssh } from "../ssh/port.ts"
import type { SshHost } from "../ssh/port.ts"
import { rewriteKubeconfig } from "./rewrite.ts"

const K3S_KUBECONFIG_PATH = "/etc/rancher/k3s/k3s.yaml"

export interface FetchKubeconfigArgs {
  readonly master1: SshHost
  readonly clusterName: string
  readonly serverUrl: string
}

// Fetch k3s's generated kubeconfig from master 1 over SSH and
// rewrite it for the real cluster name/endpoint (see rewrite.ts).
export const fetchKubeconfig = (args: FetchKubeconfigArgs): Effect.Effect<Kubeconfig, BootstrapFailed, Ssh> =>
  Effect.gen(function*() {
    const ssh = yield* Ssh
    const content = yield* ssh.readFile(args.master1, K3S_KUBECONFIG_PATH).pipe(
      Effect.mapError((error) =>
        new BootstrapFailed({ node: args.master1.ip, phase: "fetchKubeconfig", log: String(error.cause) })
      )
    )
    return { content: rewriteKubeconfig({ content, clusterName: args.clusterName, serverUrl: args.serverUrl }) }
  })
