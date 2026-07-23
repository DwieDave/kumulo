import type { Inventory } from "@kumulo/core"

// FR-5.1 — master nodes must bootstrap before workers join (master 1's
// `--cluster-init` has to be up first); ordering here is just naming
// (masters-containing-"master" first), the actual serial/parallel fan-out
// is `bootstrap/orchestrate.ts`'s job once servers are provisioned.
export const bootstrapOrder = (inventory: Inventory): ReadonlyArray<string> =>
  inventory.servers
    .map((s) => s.name)
    .toSorted((a, b) => Number(b.includes("master")) - Number(a.includes("master")))
