import { Effect } from "effect"
import type { DnsError } from "@kumulo/core"
import type { HetznerDns, HetznerDnsError, HetznerRRset } from "../client/hetzner-dns.ts"
import { toDnsError } from "./errors.ts"

const _wrap = <A>(zone: string, name: string, self: Effect.Effect<A, HetznerDnsError>): Effect.Effect<A, DnsError> =>
  Effect.mapError(self, (cause) => toDnsError({ cause, zone, name }))

/** Every RRset in the zone at the given name, or the whole zone when `name` is omitted. */
export const rrsetsAt = (
  { dns, zone, name }: { readonly dns: HetznerDns; readonly zone: string; readonly name?: string }
): Effect.Effect<ReadonlyArray<HetznerRRset>, DnsError> =>
  _wrap(zone, name ?? "*", dns.listRRsets(zone)).pipe(
    Effect.map((all) => (name === undefined ? all : all.filter((r) => r.name === name)))
  )
