import { Data } from "effect"

// Tagged error for any failed SSH operation (connect, exec, read) — mirrors
// hetzner-k3s's util/ssh.cr, which raises a single IO::Error class for all
// of connect/exec/timeout failures and lets the caller's retry loop decide
// what to do with it.
export class SshCommandError extends Data.TaggedError("SshCommandError")<{
  readonly host: string
  readonly command: string
  readonly cause: unknown
}> {}
