import { Schema } from "effect"
import { makeOutputsFile } from "@kumulo/core"
import type { ClusterTag } from "@kumulo/core"

export { OutputsInvalid } from "@kumulo/core"

export const OutputsBucket = Schema.Struct({
  id: Schema.Number,
  name: Schema.NonEmptyString,
  region: Schema.NonEmptyString,
  tier: Schema.Literals(["standard", "edge"]),
  retain: Schema.Boolean
})

export type OutputsBucket = Schema.Schema.Type<typeof OutputsBucket>

export const OutputsFile = Schema.Struct({
  cluster: Schema.NonEmptyString,
  buckets: Schema.Array(OutputsBucket)
})

export type OutputsFile = Schema.Schema.Type<typeof OutputsFile>

const _file = makeOutputsFile({
  schema: OutputsFile,
  suffix: "buckets",
  empty: (tag: ClusterTag): OutputsFile => ({ cluster: tag, buckets: [] }),
  clusterOf: (file) => file.cluster,
  order: (file) => ({ cluster: file.cluster, buckets: file.buckets })
})

export const outputsPath = _file.path

export const parseOutputsYaml = _file.parseYaml

export const stringifyOutputs = _file.stringify

export const emptyOutputs = _file.empty

export const readOutputs = _file.read

export const writeOutputs = _file.write
