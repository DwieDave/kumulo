import type { Effect } from "effect"
import { Context } from "effect"
import type {
  AuthenticationFailed,
  CapabilityMissing,
  HttpTransportError,
  ProviderApiError,
  ProvisioningTimeout,
  RateLimited,
  ResourceConflict,
  ResourceNotFound,
  ResponseDecodeError
} from "../errors/tagged.ts"
import type { EdgeInfo, EdgeRef, EdgeSpec, SecurityPolicy } from "../domain/types.ts"

export type CdnError =
  | ResourceNotFound
  | ResourceConflict
  | AuthenticationFailed
  | RateLimited
  | ProviderApiError
  | ResponseDecodeError
  | HttpTransportError
  | CapabilityMissing
  | ProvisioningTimeout

export class CdnProvider extends Context.Service<CdnProvider, {
  readonly ensureEdge: (spec: EdgeSpec) => Effect.Effect<EdgeInfo, CdnError>
  readonly ensureCertificates: (
    input: { readonly ref: EdgeRef; readonly hostnames: ReadonlyArray<string> }
  ) => Effect.Effect<void, CdnError>
  readonly ensureSecurity: (
    input: { readonly ref: EdgeRef; readonly policy: SecurityPolicy }
  ) => Effect.Effect<void, CdnError>
  readonly describeEdge: (ref: EdgeRef) => Effect.Effect<EdgeInfo, CdnError>
  readonly deleteEdge: (ref: EdgeRef) => Effect.Effect<void, CdnError>
}>()("@kumulo/core/CdnProvider") {}
