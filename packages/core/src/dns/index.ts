export { OWNERSHIP_PREFIX, ownedName, ownershipName, ownershipTarget, ownerTagOf, recordKind } from "./ownership.ts"

export type { DnsRecordKind } from "./ownership.ts"

export { reconcileDns, reconcileDnsLive } from "./reconcile.ts"

export type { DnsAdapter, ZoneRecord } from "./reconcile.ts"
