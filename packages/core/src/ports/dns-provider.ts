import { Context, Effect } from "effect"
import type { AuthenticationFailed, ResourceConflict, ResourceNotFound } from "../errors/tagged.ts"
import type { ClusterTag, DesiredRecord } from "../domain/types.ts"

export type DnsError = ResourceNotFound | ResourceConflict | AuthenticationFailed

// Design §3.5 — TXT-ownership contract binds every implementation: reconcile
// and delete only ever touch records this module created.
export class DnsProvider extends Context.Service<DnsProvider, {
  readonly ensureRecords: (
    zone: string,
    records: ReadonlyArray<DesiredRecord>
  ) => Effect.Effect<void, DnsError>
  readonly removeClusterRecords: (zone: string, tag: ClusterTag) => Effect.Effect<void, DnsError>
}>()("@kumulo/core/DnsProvider") {}
