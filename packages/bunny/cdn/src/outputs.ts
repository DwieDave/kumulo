import { Schema } from "effect"
import { makeOutputsFile } from "@kumulo/core"
import type { ClusterTag } from "@kumulo/core"

export { OutputsInvalid } from "@kumulo/core"

export const CdnOutputsFile = Schema.Struct({
  cluster: Schema.NonEmptyString,
  pullZoneId: Schema.optional(Schema.Number),
  systemHostname: Schema.optional(Schema.String),
  shieldZoneId: Schema.optional(Schema.Number),
  rules: Schema.Record(Schema.String, Schema.Number),
  lists: Schema.Record(Schema.String, Schema.Number)
})

export type CdnOutputsFile = Schema.Schema.Type<typeof CdnOutputsFile>

const _file = makeOutputsFile({
  schema: CdnOutputsFile,
  suffix: "cdn",
  empty: (tag: ClusterTag): CdnOutputsFile => ({ cluster: tag, rules: {}, lists: {} }),
  clusterOf: (file) => file.cluster,
  order: (file) => ({
    cluster: file.cluster,
    pullZoneId: file.pullZoneId,
    systemHostname: file.systemHostname,
    shieldZoneId: file.shieldZoneId,
    rules: file.rules,
    lists: file.lists
  })
})

export const cdnOutputsPath = _file.path

export const emptyCdnOutputs = _file.empty

export const parseCdnOutputsYaml = _file.parseYaml

export const stringifyCdnOutputs = _file.stringify

export const readCdnOutputs = _file.read

export const writeCdnOutputs = _file.write
