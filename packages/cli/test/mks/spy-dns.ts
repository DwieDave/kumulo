import { Effect, Layer } from "effect"
import { DnsProvider } from "@kumulo/core"
import type { DesiredRecord } from "@kumulo/core"

/** Records the calls a `reconcileDns`/`removeDns` run makes against the port. */
export const spyDnsLayer = () => {
  const ensured: Array<ReadonlyArray<DesiredRecord>> = []
  const removed: Array<string> = []
  const layer = Layer.succeed(DnsProvider, {
    ensureRecords: (_zone: string, records: ReadonlyArray<DesiredRecord>) =>
      Effect.sync(() => {
        ensured.push(records)
      }),
    removeClusterRecords: (_zone: string, tag: string) =>
      Effect.sync(() => {
        removed.push(tag)
      })
  })
  return { layer, ensured, removed }
}
