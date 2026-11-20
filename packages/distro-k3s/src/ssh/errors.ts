import { Data } from "effect"

// Tagged error for any failed SSH operation (connect, exec, read) — a
// single error class for all of connect/exec/timeout failures, leaving it
// to the caller's retry loop to decide what to do with it.
export class SshCommandError extends Data.TaggedError("SshCommandError")<{
  readonly host: string
  readonly command: string
  readonly cause: unknown
}> {}

// Host key differs from the one recorded on first connect.
export class SshHostKeyMismatch extends Data.TaggedError("SshHostKeyMismatch")<{
  readonly host: string
  readonly knownHostsPath: string
}> {
  override get message(): string {
    return `host key for ${this.host} changed since first connect; if the node was rebuilt, remove its line from ${this.knownHostsPath} and retry`
  }
}

const STDERR_LIMIT = 2000

const TOKEN_ASSIGNMENT = /(K3S_TOKEN=)('(?:[^']|'\\'')*'|"[^"]*"|\S+)/g

export const redactCommand = (command: string): string => command.replace(TOKEN_ASSIGNMENT, "$1'***'")

// keeps the tail: the actual failure is at the end of stderr
export const describeSshError = (error: SshCommandError): string => {
  const text = error.cause instanceof Error ? error.cause.message : String(error.cause)

  return text.length > STDERR_LIMIT ? `...${text.slice(-STDERR_LIMIT)}` : text
}
