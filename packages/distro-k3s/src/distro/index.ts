import { Effect } from "effect"
import type { K8sClient, SelfManagedDistroShape } from "@kumulo/core"
import { Ssh } from "../ssh/port.ts"
import type { SshHost } from "../ssh/port.ts"
import { fetchKubeconfig } from "../kubeconfig/fetch.ts"
import { resolveServerUrl } from "../kubeconfig/rewrite.ts"
import { makeReleaseCache } from "../releases/cache.ts"
import { drainAndRemove } from "./drain.ts"
import { bootstrapOrder } from "./plan.ts"
import { renderUserData } from "./user-data.ts"

export { drainAndRemove } from "./drain.ts"
export { bootstrapOrder } from "./plan.ts"

export interface MakeSelfManagedDistroArgs {
  readonly clusterName: string
  readonly sshPublicKey: string
  readonly ssh: Ssh["Service"]
  readonly k8s: K8sClient["Service"]
  readonly master1: SshHost
  readonly lbVip?: string
  readonly apiDnsName?: string
}

// Design §3.3 — assembles the k3s `SelfManagedDistroShape`, wiring T7.1's
// SSH/readiness, T7.2's bootstrap orchestration, and this task's
// kubeconfig/releases/drain into the one port core drives. Dependencies are
// closed over here (not requested via Effect context) because the port's
// method signatures carry no `R` — a Layer-provided service can't leak into
// a `Effect.Effect<A, E>` return type.
export const makeSelfManagedDistro = (args: MakeSelfManagedDistroArgs): SelfManagedDistroShape => {
  const releases = Effect.runSync(makeReleaseCache())
  const provideSsh = Effect.provideService(Ssh, args.ssh)

  return {
    kind: "self-managed",
    name: "k3s",
    planBootstrap: (_cluster, inventory) => Effect.succeed({ order: bootstrapOrder(inventory) }),
    renderUserData: renderUserData({ clusterName: args.clusterName, sshPublicKey: args.sshPublicKey }),
    fetchKubeconfig: (_entry, apiEndpoint) =>
      fetchKubeconfig({
        master1: args.master1,
        clusterName: args.clusterName,
        serverUrl: resolveServerUrl({
          lbVip: args.lbVip,
          apiDnsName: args.apiDnsName,
          masterIp: apiEndpoint
        })
      }).pipe(provideSsh),
    upgradePlan: (_target) => Effect.succeed([]), // ponytail: SUC Plan rendering is T8.3's scope
    validateVersion: releases.validateVersion,
    drainAndRemove: (node) => drainAndRemove({ client: args.k8s, node })
  }
}
