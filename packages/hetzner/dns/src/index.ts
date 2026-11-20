/** @kumulo/dns-hetzner — DnsProvider implementation against the Hetzner Cloud API's DNS zones/RRsets. */
export const packageName = "@kumulo/dns-hetzner"

export { hetznerDnsHttpLive } from "./transport/http-client.ts"

export { makeHetznerDnsClient } from "./client/hetzner-dns.ts"

export type { HetznerDns, HetznerDnsError, HetznerRRset, HetznerRRsetInput, HetznerRRsetRecord } from "./client/hetzner-dns.ts"

export { hetznerDnsProviderLive, makeHetznerDnsProvider } from "./provider/dns-provider.ts"

export type { HetznerDnsProviderOptions } from "./provider/dns-provider.ts"
