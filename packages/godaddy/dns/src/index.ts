export const packageName = "@kumulo/dns-godaddy"

export { GodaddyHttpLive } from "./transport/http-client.ts"

export { makeGodaddyDnsClient } from "./client/godaddy-dns.ts"

export type { GodaddyDnsClient } from "./client/godaddy-dns.ts"

export { godaddyDnsProviderLive } from "./provider/dns-provider.ts"

export { godaddyApexNotCname, godaddyConfigRules, godaddyTtlMinimum } from "./config.ts"
