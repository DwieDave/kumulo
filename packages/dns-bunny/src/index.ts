export const packageName = "@kumulo/dns-bunny"

export { bunnyDnsProviderLive, ensureRecords, makeBunnyDnsProvider, removeClusterRecords } from "./provider/dns-provider.ts"

export type { BunnyDnsProviderOptions } from "./provider/dns-provider.ts"
