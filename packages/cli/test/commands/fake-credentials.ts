import { ConfigProvider, Layer } from "effect"

/**
 * Credentials for command tests that inject `MksEnv`/`CloudProvider` directly.
 *
 * Those tests already assert "the environment is wired"; before
 * `requireCredentials` nothing checked, so they relied on the absence of a
 * check rather than on saying so. A `ConfigProvider` states it explicitly and
 * is the same mechanism `--secrets-file` uses, so the tests exercise the real
 * credential path instead of bypassing it.
 *
 * Deliberately NOT `...process.env`: a developer with real OVH credentials
 * exported must get the same result as CI with none.
 */
export const fakeCredentials = Layer.succeed(
  ConfigProvider.ConfigProvider,
  ConfigProvider.fromEnv({
    env: {
      OVH_CLIENT_ID: "test-client-id",
      OVH_CLIENT_SECRET: "test-client-secret",
      OVH_SERVICE_NAME: "service-1",
      HETZNER_DNS_TOKEN: "test-dns-token"
    }
  })
)
