export const packageName = "@kumulo/secrets-sops"

export { buildCredentialsPayload } from "./entries.ts"
export { decryptSopsFile, SopsSecrets, sopsConfigProvider } from "./provider.ts"
export { credentialsPath, sopsCredentialsSinkLive } from "./sink.ts"
