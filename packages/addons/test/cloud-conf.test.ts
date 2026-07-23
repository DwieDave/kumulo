import { assert, it } from "@effect/vitest"
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

it("wraps cloud.conf in a Secret in kube-system", () => {
  const secret = cloudConfSecretManifest(conf)
  assert.strictEqual(secret.kind, "Secret")
  assert.deepStrictEqual(secret.metadata, { name: "cloud-config", namespace: "kube-system" })
  const stringData = secret.stringData
  const cloudConfIni = typeof stringData === "object" && stringData !== null && "cloud.conf" in stringData
    ? stringData["cloud.conf"]
    : undefined
  assert.match(String(cloudConfIni), /application-credential-id=app-id/)
})
