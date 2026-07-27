// kumulo: TXT ownership contract — a sibling TXT record at the
// same subdomain, valued `kumulo.cluster=<name>`, marks a record as
// kumulo-owned (external-dns convention). Every mutation checks this before
// touching a record it didn't create. Single source of truth for all DNS
// adapters (they may only share code through core).
export const OWNERSHIP_PREFIX = "kumulo.cluster="

export const ownershipTarget = (tag: string): string => `${OWNERSHIP_PREFIX}${tag}`

export const ownerTagOf = (target: string): string | undefined =>
  target.startsWith(OWNERSHIP_PREFIX) ? target.slice(OWNERSHIP_PREFIX.length) : undefined

const _isIpv4 = (target: string): boolean =>
  /^\d{1,3}(\.\d{1,3}){3}$/.test(target) && target.split(".").every((o) => Number(o) <= 255)

// ponytail: shape check, not a full RFC 4291 parser — enough to tell an IPv6
// literal from a hostname (hostnames can't contain `:`). Swap in a real parser
// if targets ever come from untrusted input.
const _isIpv6 = (target: string): boolean => target.includes(":") && /^[0-9a-fA-F:]+$/.test(target)

export type DnsRecordKind = "TXT" | "A" | "AAAA" | "CNAME"

/** Record type inferred from the resolved target value (no explicit field on `DesiredRecord`). */
export const recordKind = (target: string): DnsRecordKind =>
  ownerTagOf(target) !== undefined ? "TXT" : _isIpv4(target) ? "A" : _isIpv6(target) ? "AAAA" : "CNAME"
