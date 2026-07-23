import { Effect } from "effect"
import type { NodeContext, NodeRole } from "@kumulo/core"
import { renderCloudInit } from "../cloudinit/render.ts"

export interface RenderUserDataArgs {
  readonly clusterName: string
  readonly sshPublicKey: string
}

// FR-5.1 — cloud-init only (hostname, packages, SSH hardening); k3s install
// happens over SSH afterward (bootstrap/install-script.ts), so `ctx`'s
// token/apiEndpoint aren't needed at this layer — same split the cloud-init
// renderer itself documents. Hostname is `ctx.name` (the node's own unique
// name, e.g. `master-1`) — a role-wide template collides across every
// master/worker of a role, and k3s derives node identity from the hostname.
export const renderUserData = (
  args: RenderUserDataArgs
) =>
(_role: NodeRole, ctx: NodeContext): Effect.Effect<string> =>
  Effect.succeed(renderCloudInit({ hostname: ctx.name, sshPublicKey: args.sshPublicKey }))
