export const packageName = "@kumulo/cdn-bunny"

export { makeBunnyCdnProvider } from "./provider/cdn-provider.ts"

export { makeBunnyShield } from "./provider/shield.ts"

export { diffEdge } from "./diff.ts"

export {
  CdnOutputsFile,
  cdnOutputsPath,
  emptyCdnOutputs,
  OutputsInvalid,
  parseCdnOutputsYaml,
  readCdnOutputs,
  writeCdnOutputs
} from "./outputs.ts"

export { bunnyCdnConfigRules, cdnApexRequiresBunnyDns } from "./config.ts"
