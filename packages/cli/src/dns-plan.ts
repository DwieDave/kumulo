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

/**
 * The plan-time half of `DnsTargets` (cli `dns.ts`): the same placeholders, but
 * only the *kind* each resolves to, since plan reads no live address. Absent =
 * this plan resolves that placeholder to nothing, so it must render as whatever
 * the apply writes for an unresolved target — the literal string itself.
 */
export interface DnsPlanTargets {
  readonly api_server: DnsTarget["kind"]
  readonly ingress?: DnsTarget["kind"]
}

// `recordKind` (core, single source of truth) resolves a concrete target; at
// plan time a placeholder isn't resolved yet, so its kind comes from the
// declared `DnsTarget` kind instead — and an unresolvable one falls back to
// `recordKind` of the placeholder, which is exactly what the apply writes.
const _kindOf = (target: string, targets: DnsPlanTargets): DnsRecordKind => {
  const kind = target === "api_server" || target === "ingress" ? targets[target] : undefined
  return kind === undefined ? recordKind(target) : kind === "ip" ? "A" : "CNAME"
}

/**
 * DNS rows for the plan: one Create per desired record, none when
 * `dns.module` is `none` (FR5). Always Create — the providers are idempotent
 * and existing-record lookup isn't part of planning yet.
 */
export const dnsPlanActions = (
  { config, targets }: { readonly config: DnsPlanInput; readonly targets: DnsPlanTargets }
): ReadonlyArray<PlanAction> =>
  config.module === "none" ? [] : config.records.map((record) => ({
    _tag: "Create",
    name: `dns/${config.zone}/${record.name} (${_kindOf(record.target, targets)})`
  }))
