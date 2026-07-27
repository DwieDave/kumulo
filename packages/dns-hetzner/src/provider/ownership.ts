// kumulo: the TXT ownership contract lives in @kumulo/core (single source of
// truth for every DNS adapter); this file is only a re-export so local imports
// keep working.
export { OWNERSHIP_PREFIX, ownershipTarget, ownerTagOf, recordKind } from "@kumulo/core"
export type { DnsRecordKind } from "@kumulo/core"
