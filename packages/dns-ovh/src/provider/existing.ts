import { Effect } from "effect"
import type { SchemaError } from "effect/Schema"
import type * as HttpClientError from "effect/unstable/http/HttpClientError"
import type { DnsError } from "@kumulo/core"
import type { Dns } from "../generated/client.ts"
import { toDnsError } from "./errors.ts"

export interface ZoneRecord {
  readonly id: number
  readonly fieldType: string
  readonly subDomain: string
  readonly target: string
}

const _wrap = <A>(
  zone: string,
  name: string,
  self: Effect.Effect<A, HttpClientError.HttpClientError | SchemaError>
): Effect.Effect<A, DnsError> => Effect.mapError(self, (cause) => toDnsError({ cause, zone, name }))

const _toZoneRecord = (raw: { id?: number; fieldType?: string; subDomain?: string | null; target?: string }): ZoneRecord => ({
  id: raw.id ?? 0,
  fieldType: raw.fieldType ?? "",
  subDomain: raw.subDomain ?? "",
  target: raw.target ?? ""
})

/** Fetches every record at `subDomain` (or the whole zone, when omitted). */
export const recordsAt = (
  { dns, zone, subDomain }: { readonly dns: Dns; readonly zone: string; readonly subDomain?: string }
): Effect.Effect<ReadonlyArray<ZoneRecord>, DnsError> =>
  Effect.gen(function*() {
    const name = subDomain ?? "*"
    const ids = yield* _wrap(zone, name, dns.getRecords(zone, subDomain === undefined ? undefined : { params: { subDomain } }))
    // ponytail: concurrency 4 — OVH client has no transport-level rate guard, keep it modest
    const raws = yield* Effect.forEach(ids, (id) => _wrap(zone, name, dns.getRecord(zone, String(id), undefined)), { concurrency: 4 })
    return raws.map(_toZoneRecord)
  })
