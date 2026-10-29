import type { EdgeInfo, EdgeSpec } from "@kumulo/core"

export type EdgeDrift = "Unchanged" | "Update" | "ReplaceNeedsConfirm"

const _sameSet = (left: ReadonlyArray<string>, right: ReadonlyArray<string>): boolean =>
  left.length === right.length && left.every((value) => right.includes(value))

export const diffEdge = ({ info, spec }: { readonly spec: EdgeSpec; readonly info: EdgeInfo }): EdgeDrift => {
  if (spec.name !== info.ref.name || spec.tier !== info.tier) return "ReplaceNeedsConfirm"

  const unchanged = spec.originUrl === info.originUrl
    && spec.verifyOriginTls === info.verifyOriginTls
    && spec.websockets === info.websockets
    && spec.cache === info.cache
    && _sameSet(spec.hostnames, info.hostnames)

  return unchanged ? "Unchanged" : "Update"
}
