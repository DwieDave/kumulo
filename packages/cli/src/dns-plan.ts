import { recordKind } from "@kumulo/core"
import type { DnsRecordKind, PlanAction } from "@kumulo/core"
import type { DnsTarget } from "./dns.ts"

/**
 * Structural slice of `ClusterConfig["dns"]` — same pattern as `MksPlanInput`,
 * so plan tests don't need a full config.
 */
export type DnsPlanInput =
  | { readonly module: "none" }
  | {
    readonly module: "ovh" | "hetzner"
    readonly zone: string
    readonly records: ReadonlyArray<{ readonly name: string; readonly target: string }>
  }

// `recordKind` (core, single source of truth) resolves a concrete target; at
// plan time the `api_server` placeholder isn't resolved yet, so its kind comes
// from the `DnsTarget` kind instead.
const _kindOf = (target: string, apiTargetKind: DnsTarget["kind"]): DnsRecordKind =>
  target === "api_server" ? (apiTargetKind === "ip" ? "A" : "CNAME") : recordKind(target)

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
