import { recordKind } from "@kumulo/core"
import type { DnsRecordKind, PlanAction } from "@kumulo/core"
import type { DnsTarget } from "./dns.ts"

export type DnsPlanInput =
  | { readonly module: "none" }
  | {
    readonly module: "ovh" | "hetzner"
    readonly zone: string
    readonly records: ReadonlyArray<{ readonly name: string; readonly target: string }>
  }

export interface DnsPlanTargets {
  readonly api_server: DnsTarget["kind"]
  readonly ingress?: DnsTarget["kind"]
}

const _kindOf = (target: string, targets: DnsPlanTargets): DnsRecordKind => {
  const kind = target === "api_server" || target === "ingress" ? targets[target] : undefined
  return kind === undefined ? recordKind(target) : kind === "ip" ? "A" : "CNAME"
}

export const dnsPlanActions = (
  { config, targets }: { readonly config: DnsPlanInput; readonly targets: DnsPlanTargets }
): ReadonlyArray<PlanAction> =>
  config.module === "none" ? [] : config.records.map((record) => ({
    _tag: "Create",
    name: `dns/${config.zone}/${record.name} (${_kindOf(record.target, targets)})`
  }))
