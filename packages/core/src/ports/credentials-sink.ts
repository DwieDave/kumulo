import { Context, Effect } from "effect"
import type { CredentialsSinkError } from "../errors/tagged.ts"
import type { CredentialEntry } from "../domain/types.ts"

// Resource-agnostic secret sink (D5+D6) — object storage is the first
// caller, but the port carries no bucket-shaped knowledge.
export class CredentialsSink extends Context.Service<CredentialsSink, {
  readonly write: (entries: ReadonlyArray<CredentialEntry>) => Effect.Effect<void, CredentialsSinkError>
}>()("@kumulo/core/CredentialsSink") {}
