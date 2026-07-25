import type { PlanAction } from "@kumulo/core"
import type { DnsTarget } from "./dns.ts"

/**
 * Structural slice of `ClusterConfig["dns"]` — same pattern as `MksPlanInput`,
 * so plan tests don't need a full config.
 */
export interface DnsPlanInput {
  readonly module: string
  readonly zone: string
  readonly records: ReadonlyArray<{ readonly name: string; readonly target: string }>
}

// Mirrors `recordKind` in the dns packages (dependency-cruiser forbids
// importing it across sibling packages) — but at plan time the api_server
// value isn't known yet, so its kind comes from the `DnsTarget` kind instead.
const _isIp = (target: string): boolean =>
  /^\d{1,3}(\.\d{1,3}){3}$/.test(target) || (target.includes(":") && /^[0-9a-fA-F:]+$/.test(target))

const _kindOf = (target: string, apiTargetKind: DnsTarget["kind"]): "A" | "CNAME" =>
  target === "api_server" ? (apiTargetKind === "ip" ? "A" : "CNAME") : _isIp(target) ? "A" : "CNAME"

/**
 * DNS rows for the plan: one Create per desired record, none when
 * `dns.module` is `none` (FR5). Always Create — the providers are idempotent
 * and existing-record lookup isn't part of planning yet.
 */
export const dnsPlanActions = (
  { config, targetKind }: { readonly config: DnsPlanInput; readonly targetKind: DnsTarget["kind"] }
): ReadonlyArray<PlanAction> =>
  config.module === "none" ? [] : config.records.map((record) => ({
    _tag: "Create",
    name: `dns/${config.zone}/${record.name} (${_kindOf(record.target, targetKind)})`
  }))
