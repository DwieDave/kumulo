import type { Effect } from "effect";
import { Context } from "effect"
import type {
  AuthenticationFailed,
  HttpTransportError,
  ProviderApiError,
  RateLimited,
  ResourceConflict,
  ResourceNotFound,
  ResponseDecodeError
} from "../errors/tagged.ts"
import type { ClusterTag, DesiredRecord } from "../domain/types.ts"

// A DNS API outage, a rate limit and a malformed body are distinct failures —
// none of them is a "conflict", so the union carries a tag for each.
export type DnsError =
  | ResourceNotFound
  | ResourceConflict
  | AuthenticationFailed
  | RateLimited
  | ProviderApiError
  | ResponseDecodeError
  | HttpTransportError

// TXT-ownership contract binds every implementation: reconcile
// and delete only ever touch records this module created.
export class DnsProvider extends Context.Service<DnsProvider, {
  readonly ensureRecords: (
    zone: string,
    records: ReadonlyArray<DesiredRecord>
  ) => Effect.Effect<void, DnsError>
  readonly removeClusterRecords: (zone: string, tag: ClusterTag) => Effect.Effect<void, DnsError>
}>()("@kumulo/core/DnsProvider") {}
