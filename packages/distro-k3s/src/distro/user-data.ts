import { Effect } from "effect"
import type { NodeContext, NodeRole } from "@kumulo/core"
import { renderCloudInit } from "../cloudinit/render.ts"

export interface RenderUserDataArgs {
  readonly clusterName: string
  readonly sshPublicKey: string
}

// cloud-init only; k3s install happens over SSH afterward via bootstrap/install-script.ts
export const renderUserData = (
  args: RenderUserDataArgs
) =>
(_role: NodeRole, ctx: NodeContext): Effect.Effect<string> =>
  Effect.succeed(renderCloudInit({ hostname: ctx.name, sshPublicKey: args.sshPublicKey }))
