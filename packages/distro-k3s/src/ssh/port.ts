import type { Effect } from "effect";
import { Context } from "effect"
import type { SshCommandError } from "./errors.ts"

export interface SshHost {
  readonly ip: string
  readonly port: number
}

export class Ssh extends Context.Service<Ssh, {
  readonly exec: (host: SshHost, command: string) => Effect.Effect<string, SshCommandError>
  readonly readFile: (host: SshHost, path: string) => Effect.Effect<string, SshCommandError>
  readonly waitReady: (host: SshHost) => Effect.Effect<void, SshCommandError>
}>()("@kumulo/distro-k3s/Ssh") {}
