/** @kumulo/dns-hetzner — DnsProvider implementation against the Hetzner Cloud API's DNS zones/RRsets. */
export const packageName = "@kumulo/dns-hetzner"

export { HETZNER_API_BASE_URL, HetznerHttpLive, makeHetznerHttpClient } from "./transport/http-client.ts"

export { makeHetznerDnsClient } from "./client/hetzner-dns.ts"
export type { HetznerDns, HetznerDnsError, HetznerRRset, HetznerRRsetInput, HetznerRRsetRecord, HetznerZone } from "./client/hetzner-dns.ts"

export { ensureRecords, hetznerDnsProviderLive, makeHetznerDnsProvider, removeClusterRecords } from "./provider/dns-provider.ts"

export { recordKind } from "./provider/ownership.ts"
export type { DnsRecordKind } from "./provider/ownership.ts"
