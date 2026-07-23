import { Effect } from "effect"
import { parse } from "yaml"
import { ConfigInvalid } from "../errors/tagged.ts"

export interface TokenAuth {
  readonly kind: "token"
  readonly token: string
}
export interface ClientCertAuth {
  readonly kind: "clientCert"
  readonly certPem: string
  readonly keyPem: string
}
export type KubeconfigAuth = TokenAuth | ClientCertAuth

export interface KubeconfigContext {
  readonly server: string
  readonly caPem?: string
  readonly auth: KubeconfigAuth
}

const _invalid = (message: string): ConfigInvalid => new ConfigInvalid({ issues: [{ path: [], message }] })

const _base64Decode = (value: string): string => globalThis.atob(value)

const _isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null

const _field = (value: unknown, key: string): unknown => _isRecord(value) ? value[key] : undefined

// kumulo: only token and client-cert auth are needed (FR-9.2) — kubeconfigs
// from k3s (client-cert) and MKS (token) never use exec/oidc plugins.
const _parseAuth = (user: unknown): KubeconfigAuth | undefined => {
  const token = _field(user, "token")
  if (typeof token === "string") return { kind: "token", token }
  const certData = _field(user, "client-certificate-data")
  const keyData = _field(user, "client-key-data")
  if (typeof certData === "string" && typeof keyData === "string") {
    return { kind: "clientCert", certPem: _base64Decode(certData), keyPem: _base64Decode(keyData) }
  }
  return undefined
}

// kumulo: single-context kubeconfigs only (what k3s/MKS emit) — no
// current-context resolution across multiple clusters/users.
export const parseKubeconfig = (text: string): Effect.Effect<KubeconfigContext, ConfigInvalid> =>
  Effect.try({ try: () => parse(text), catch: (cause) => _invalid(String(cause)) }).pipe(
    Effect.flatMap((doc) => {
      const cluster = _field(_field(_field(doc, "clusters"), "0"), "cluster")
      const server = _field(cluster, "server")
      const caData = _field(cluster, "certificate-authority-data")
      const user = _field(_field(_field(doc, "users"), "0"), "user")
      const auth = _parseAuth(user)
      if (typeof server !== "string" || auth === undefined) {
        return Effect.fail(_invalid("kubeconfig missing cluster.server or a token/client-cert user"))
      }
      return Effect.succeed({
        server,
        caPem: typeof caData === "string" ? _base64Decode(caData) : undefined,
        auth
      })
    })
  )
