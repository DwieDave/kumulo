// kumulo: TXT ownership contract — a sibling TXT record at the
// same subdomain, valued `kumulo.cluster=<name>`, marks a record as
// kumulo-owned (external-dns convention). Every mutation checks this before
// touching a record it didn't create. Same convention as dns-ovh's
// `ownership.ts` — duplicated, not imported, because dependency-cruiser
// forbids sibling-package imports outside `@kumulo/core`.
export const OWNERSHIP_PREFIX = "kumulo.cluster="

export const ownershipTarget = (tag: string): string => `${OWNERSHIP_PREFIX}${tag}`

export const ownerTagOf = (target: string): string | undefined =>
  target.startsWith(OWNERSHIP_PREFIX) ? target.slice(OWNERSHIP_PREFIX.length) : undefined

const _isIpv4 = (target: string): boolean => /^\d{1,3}(\.\d{1,3}){3}$/.test(target)

const _isIpv6 = (target: string): boolean => target.includes(":") && /^[0-9a-fA-F:]+$/.test(target)

/** RRset type inferred from the resolved target value (no explicit field on `DesiredRecord`) — adds AAAA over dns-ovh's A/CNAME/TXT set (R4). */
export const recordKind = (target: string): DnsRecordKind =>
  ownerTagOf(target) !== undefined ? "TXT" : _isIpv4(target) ? "A" : _isIpv6(target) ? "AAAA" : "CNAME"

export type DnsRecordKind = "TXT" | "A" | "AAAA" | "CNAME"
