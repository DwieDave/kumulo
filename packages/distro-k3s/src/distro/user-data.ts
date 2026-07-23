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
// renderer itself documents.
export const renderUserData = (
  args: RenderUserDataArgs
) =>
(role: NodeRole, _ctx: NodeContext): Effect.Effect<string> =>
  Effect.succeed(renderCloudInit({ hostname: `${args.clusterName}-${role}`, sshPublicKey: args.sshPublicKey }))
