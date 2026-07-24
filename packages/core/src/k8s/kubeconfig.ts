import { Effect, Schema } from "effect"
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

// kumulo: lenient decode — every field is optional at the schema
// level (a kubeconfig's cluster/user entry may carry only some of these),
// with "is the shape we need actually present" decided afterward in
// `_parseAuth`/`parseKubeconfig` rather than by the schema failing outright.
// `Schema.Unknown` array elements (not a nested cluster/user schema) because
// only entry `0` is ever read — see the single-context comment below.
const _KubeconfigDoc = Schema.Struct({
  clusters: Schema.optional(Schema.Array(Schema.Struct({
    cluster: Schema.optional(Schema.Struct({
      server: Schema.optional(Schema.String),
      "certificate-authority-data": Schema.optional(Schema.String)
    }))
  }))),
  users: Schema.optional(Schema.Array(Schema.Struct({
    user: Schema.optional(Schema.Struct({
      token: Schema.optional(Schema.String),
      "client-certificate-data": Schema.optional(Schema.String),
      "client-key-data": Schema.optional(Schema.String)
    }))
  })))
})
type KubeconfigDoc = typeof _KubeconfigDoc.Type
type KubeconfigUser = NonNullable<NonNullable<KubeconfigDoc["users"]>[number]["user"]>

// kumulo: only token and client-cert auth are needed — kubeconfigs
// from k3s (client-cert) and MKS (token) never use exec/oidc plugins.
const _parseAuth = (user: KubeconfigUser | undefined): KubeconfigAuth | undefined => {
  if (user?.token !== undefined) return { kind: "token", token: user.token }
  const certData = user?.["client-certificate-data"]
  const keyData = user?.["client-key-data"]
  if (certData !== undefined && keyData !== undefined) {
    return { kind: "clientCert", certPem: _base64Decode(certData), keyPem: _base64Decode(keyData) }
  }
  return undefined
}

// kumulo: single-context kubeconfigs only (what k3s/MKS emit) — no
// current-context resolution across multiple clusters/users.
export const parseKubeconfig = (text: string): Effect.Effect<KubeconfigContext, ConfigInvalid> =>
  Effect.try({ try: () => parse(text), catch: (cause) => _invalid(String(cause)) }).pipe(
    Effect.flatMap((yaml) => Schema.decodeUnknownEffect(_KubeconfigDoc)(yaml).pipe(Effect.mapError(() => _invalid("kubeconfig is not a valid document")))),
    Effect.flatMap((doc) => {
      const cluster = doc.clusters?.[0]?.cluster
      const user = doc.users?.[0]?.user
      const auth = _parseAuth(user)
      if (cluster?.server === undefined || auth === undefined) {
        return Effect.fail(_invalid("kubeconfig missing cluster.server or a token/client-cert user"))
      }
      return Effect.succeed({
        server: cluster.server,
        caPem: cluster["certificate-authority-data"] === undefined
          ? undefined
          : _base64Decode(cluster["certificate-authority-data"]),
        auth
      })
    })
  )
