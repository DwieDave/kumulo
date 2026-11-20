/** @kumulo/dns-ovh — package barrel. */
export const packageName = "@kumulo/dns-ovh"

export { makeDnsClient } from "./client/dns.ts"

export type { Dns, DnsError } from "./client/dns.ts"

export { makeOvhDnsProvider, ovhDnsProviderLive } from "./provider/dns-provider.ts"
