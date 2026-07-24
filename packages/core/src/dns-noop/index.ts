import { Effect, Layer } from "effect"
import { DnsProvider } from "../ports/dns-provider.ts"

// `dns.module: none` built-in: DNS managed elsewhere, every
// call is a no-op. Ships in core since it has no external backend.
export const dnsNoop = {
  ensureRecords: () => Effect.void,
  removeClusterRecords: () => Effect.void
}

export const dnsNoopLive = Layer.succeed(DnsProvider, dnsNoop)
