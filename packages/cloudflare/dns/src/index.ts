export const packageName = "@kumulo/dns-cloudflare"

export { CLOUDFLARE_API_BASE_URL, CloudflareHttpLive } from "./transport/http-client.ts"

export { makeCloudflareDnsClient } from "./client/cloudflare-dns.ts"

export type { CloudflareDnsClient, CloudflareZone } from "./client/cloudflare-dns.ts"

export { cloudflareDnsProviderLive, zoneNotVisible } from "./provider/dns-provider.ts"

export { cloudflareConfigRules, cloudflareTtlRange } from "./config.ts"
