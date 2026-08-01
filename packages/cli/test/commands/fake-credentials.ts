import { ConfigProvider, Layer } from "effect"

// Deliberately NOT `...process.env`: real exported OVH creds must not leak into tests.
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
