import { assert, it } from "@effect/vitest"
import { Option, Schema } from "effect"
import { cloudConfSecretManifest, renderCloudConfIni } from "../src/cloud-conf.ts"

const conf = {
  authUrl: "https://auth.cloud.ovh.net/v3",
  region: "GRA",
  applicationCredentialId: "app-id",
  applicationCredentialSecret: "app-secret"
}

it("renders a minimal-scope cloud.conf ini", () => {
  assert.strictEqual(
    renderCloudConfIni(conf),
    [
      "[Global]",
      "auth-url=https://auth.cloud.ovh.net/v3",
      "region=GRA",
      "application-credential-id=app-id",
      "application-credential-secret=app-secret",
      "use-application-credentials=true",
      ""
    ].join("\n")
  )
})

const _stringData = Schema.decodeUnknownOption(Schema.Struct({ "cloud.conf": Schema.String }))

it("wraps cloud.conf in a Secret in kube-system", () => {
  const secret = cloudConfSecretManifest(conf)
  assert.strictEqual(secret.kind, "Secret")
  assert.deepStrictEqual(secret.metadata, { name: "cloud-config", namespace: "kube-system" })
  const cloudConfIni = Option.getOrUndefined(_stringData(secret.stringData))?.["cloud.conf"]

  assert.match(String(cloudConfIni), /application-credential-id=app-id/)
})
