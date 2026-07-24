import { Data } from "effect"

// Tagged error for any failed SSH operation (connect, exec, read) — a
// single error class for all of connect/exec/timeout failures, leaving it
// to the caller's retry loop to decide what to do with it.
export class SshCommandError extends Data.TaggedError("SshCommandError")<{
  readonly host: string
  readonly command: string
  readonly cause: unknown
}> {}
