import { makeOutputsFile, OutputsInvalid } from "@kumulo/core"
import { Schema } from "effect"

export const OutputsVolume = Schema.Struct({
  name: Schema.NonEmptyString,
  id: Schema.NonEmptyString,
  retain: Schema.Boolean
})

export type OutputsVolume = Schema.Schema.Type<typeof OutputsVolume>

export const OutputsIngress = Schema.Struct({
  load_balancer_id: Schema.NonEmptyString,
  floating_ip: Schema.NonEmptyString
})

export type OutputsIngress = Schema.Schema.Type<typeof OutputsIngress>

export const OutputsFile = Schema.Struct({
  cluster: Schema.NonEmptyString,
  volumes: Schema.Array(OutputsVolume),
  ingress: Schema.optionalKey(OutputsIngress)
})

export type OutputsFile = Schema.Schema.Type<typeof OutputsFile>

const _file = makeOutputsFile({
  schema: OutputsFile,
  suffix: "outputs",
  empty: (tag): OutputsFile => ({ cluster: tag, volumes: [] }),
  clusterOf: (file) => file.cluster,
  order: (file) =>
    file.ingress === undefined
      ? { cluster: file.cluster, volumes: file.volumes }
      : { cluster: file.cluster, volumes: file.volumes, ingress: file.ingress }
})

export { OutputsInvalid }

export const outputsPath = _file.path

export const decodeOutputs = _file.decode

export const parseOutputsYaml = _file.parseYaml

export const stringifyOutputs = _file.stringify

export const stringifyOutputsYaml = (file: OutputsFile): string => _file.stringify({ file })

export const emptyOutputs = _file.empty

export const readOutputs = _file.read

export const writeOutputs = _file.write

export const upsertVolume = (
  { file, volume }: { readonly file: OutputsFile; readonly volume: OutputsVolume }
): OutputsFile => ({
  cluster: file.cluster,
  volumes: [...file.volumes.filter((existing: OutputsVolume) => existing.name !== volume.name), volume]
})

export const setIngress = (
  { file, ingress }: { readonly file: OutputsFile; readonly ingress: OutputsIngress }
): OutputsFile => ({ cluster: file.cluster, volumes: file.volumes, ingress })

export const removeVolume = ({ file, name }: { readonly file: OutputsFile; readonly name: string }): OutputsFile => ({
  cluster: file.cluster,
  volumes: file.volumes.filter((existing: OutputsVolume) => existing.name !== name)
})
