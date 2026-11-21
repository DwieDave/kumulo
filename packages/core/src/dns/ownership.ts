export const OWNERSHIP_PREFIX = "kumulo.cluster="

export const ownershipTarget = (tag: string): string => `${OWNERSHIP_PREFIX}${tag}`

export const ownerTagOf = (target: string): string | undefined =>
  target.startsWith(OWNERSHIP_PREFIX) ? target.slice(OWNERSHIP_PREFIX.length) : undefined

// The ownership TXT of a name sits at _kumulo.<name>, never at the name itself: RFC 1034 3.6.2 lets a
// name with a CNAME hold no other data, and strict providers refuse the TXT. A leading wildcard label
// becomes _wildcard, because a "*" anywhere but first is a literal asterisk that providers reject.
const OWNERSHIP_LABEL = "_kumulo"

const WILDCARD_LABEL = "_wildcard"

// `name` and the result are in the adapter's normalized form; apexKey is how that form spells the apex.
export const ownershipName = ({ apexKey, name }: { readonly name: string; readonly apexKey: string }): string => {
  if (name === apexKey && !apexKey.includes(".")) return OWNERSHIP_LABEL

  const [first, ...rest] = name.split(".")

  return [OWNERSHIP_LABEL, first === "*" ? WILDCARD_LABEL : first, ...rest].join(".")
}

// The owned name an ownership TXT at `name` speaks for, or undefined when `name` is no ownership name.
export const ownedName = ({ apexKey, name }: { readonly name: string; readonly apexKey: string }): string | undefined => {
  if (name === OWNERSHIP_LABEL) return apexKey

  if (!name.startsWith(`${OWNERSHIP_LABEL}.`)) return undefined

  const [first, ...rest] = name.slice(OWNERSHIP_LABEL.length + 1).split(".")

  return [first === WILDCARD_LABEL ? "*" : first, ...rest].join(".")
}

const _isIpv4 = (target: string): boolean =>
  /^\d{1,3}(\.\d{1,3}){3}$/.test(target) && target.split(".").every((o) => Number(o) <= 255)

// shape check, not a full RFC 4291 parser; swap in a real parser if targets ever come from untrusted input.
const _isIpv6 = (target: string): boolean => target.includes(":") && /^[0-9a-fA-F:]+$/.test(target)

export type DnsRecordKind = "TXT" | "A" | "AAAA" | "CNAME"

export const recordKind = (target: string): DnsRecordKind =>
  ownerTagOf(target) !== undefined ? "TXT" : _isIpv4(target) ? "A" : _isIpv6(target) ? "AAAA" : "CNAME"
