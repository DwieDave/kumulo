import { Context, Effect } from "effect"
import type { SshCommandError } from "./errors.ts"

// A node to reach over SSH — bootstrap always targets IPs directly (no
// bastion hop modeled yet), private IP preferred once nodes are joined.
export interface SshHost {
  readonly ip: string
  readonly port: number
}

// Thin port over raw SSH: exec a command, read a remote file, and a
// low-level "can we even open a session" probe. Higher readiness gates
// (readiness.ts) compose these with retry/timeout, kept out of the port
// itself so the port stays a dumb transport.
export class Ssh extends Context.Service<Ssh, {
  readonly exec: (host: SshHost, command: string) => Effect.Effect<string, SshCommandError>
  readonly readFile: (host: SshHost, path: string) => Effect.Effect<string, SshCommandError>
  readonly waitReady: (host: SshHost) => Effect.Effect<void, SshCommandError>
}>()("@kumulo/distro-k3s/Ssh") {}
