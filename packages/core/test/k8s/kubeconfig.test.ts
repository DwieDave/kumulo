import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import { parseKubeconfig } from "../../src/k8s/kubeconfig.ts"

const _b64 = (value: string): string => globalThis.btoa(value)

describe("parseKubeconfig", () => {
  it.effect("parses token auth", () =>
    Effect.gen(function*() {
      const text = `
clusters:
  - cluster:
      server: https://10.0.0.1:6443
      certificate-authority-data: ${_b64("ca-pem")}
users:
  - user:
      token: tok-123
`
      const ctx = yield* parseKubeconfig(text)
      expect(ctx.server).toBe("https://10.0.0.1:6443")
      expect(ctx.caPem).toBe("ca-pem")
      expect(ctx.auth).toEqual({ kind: "token", token: "tok-123" })
    }))

  it.effect("parses client-cert auth", () =>
    Effect.gen(function*() {
      const text = `
clusters:
  - cluster:
      server: https://10.0.0.2:6443
users:
  - user:
      client-certificate-data: ${_b64("cert-pem")}
      client-key-data: ${_b64("key-pem")}
`
      const ctx = yield* parseKubeconfig(text)
      expect(ctx.auth).toEqual({ kind: "clientCert", certPem: "cert-pem", keyPem: "key-pem" })
      expect(ctx.caPem).toBeUndefined()
    }))

  it.effect("fails with ConfigInvalid on missing server", () =>
    Effect.gen(function*() {
      const result = yield* Effect.flip(parseKubeconfig("clusters: []\nusers: []\n"))
      expect(result._tag).toBe("ConfigInvalid")
    }))

  it.effect("fails with ConfigInvalid on unparsable yaml", () =>
    Effect.gen(function*() {
      const result = yield* Effect.flip(parseKubeconfig("not: [valid"))
      expect(result._tag).toBe("ConfigInvalid")
    }))
})
