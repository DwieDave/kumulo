export const packageName = "@kumulo/cdn-bunny"

export { bunnyCdnProviderLive, bunnyHostnameLimit, makeBunnyCdnProvider } from "./provider/cdn-provider.ts"

export type { BunnyCdnProviderOptions, CertificateStatus } from "./provider/cdn-provider.ts"

export { makeBunnyShield } from "./provider/shield.ts"

export type { BunnyShield, BunnyShieldOptions } from "./provider/shield.ts"

export { diffEdge } from "./diff.ts"

export type { EdgeDrift } from "./diff.ts"

export {
  CdnOutputsFile,
  CdnOutputsInvalid,
  cdnOutputsPath,
  decodeCdnOutputs,
  emptyCdnOutputs,
  parseCdnOutputsYaml,
  readCdnOutputs,
  stringifyCdnOutputs,
  writeCdnOutputs
} from "./outputs.ts"
