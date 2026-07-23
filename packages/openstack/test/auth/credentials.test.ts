import { describe, expect, it } from "@effect/vitest"
import { Effect, Exit } from "effect"
import { credentialsFromCloudsYaml, credentialsFromEnv, loadCredentials } from "../../src/auth/credentials.ts"

describe("credentialsFromEnv", () => {
  it.effect("reads application-credential auth from OS_* env vars", () =>
    Effect.gen(function*() {
      const credentials = yield* credentialsFromEnv({
        OS_AUTH_URL: "https://keystone.example.com/v3",
        OS_REGION_NAME: "gra",
        OS_APPLICATION_CREDENTIAL_ID: "app-id",
        OS_APPLICATION_CREDENTIAL_SECRET: "app-secret"
      })
      expect(credentials).toEqual({
        method: "application_credential",
        authUrl: "https://keystone.example.com/v3",
        applicationCredentialId: "app-id",
        applicationCredentialSecret: "app-secret",
        region: "gra"
      })
    }))

  it.effect("reads password auth from OS_* env vars, defaulting domains", () =>
    Effect.gen(function*() {
      const credentials = yield* credentialsFromEnv({
        OS_AUTH_URL: "https://keystone.example.com/v3",
        OS_REGION_NAME: "gra",
        OS_USERNAME: "alice",
        OS_PASSWORD: "hunter2",
        OS_PROJECT_NAME: "kumulo"
      })
      expect(credentials).toEqual({
        method: "password",
        authUrl: "https://keystone.example.com/v3",
        username: "alice",
        password: "hunter2",
        projectName: "kumulo",
        userDomain: "Default",
        projectDomain: "Default",
        region: "gra"
      })
    }))

  it("fails with AuthenticationFailed when a required field is missing", async () => {
    const exit = await Effect.runPromiseExit(credentialsFromEnv({ OS_AUTH_URL: "https://x" }))
    expect(Exit.isFailure(exit)).toBe(true)
  })
})

describe("credentialsFromCloudsYaml", () => {
  const yaml = `
clouds:
  mycloud:
    region_name: gra
    auth:
      auth_url: https://keystone.example.com/v3
      application_credential_id: app-id
      application_credential_secret: app-secret
`

  it.effect("parses an openstacksdk-compatible clouds.yaml", () =>
    Effect.gen(function*() {
      const credentials = yield* credentialsFromCloudsYaml({ fileContents: yaml, cloudName: "mycloud" })
      expect(credentials.method).toBe("application_credential")
      expect(credentials.authUrl).toBe("https://keystone.example.com/v3")
    }))

  it("fails with AuthenticationFailed for an unknown cloud name", async () => {
    const exit = await Effect.runPromiseExit(credentialsFromCloudsYaml({ fileContents: yaml, cloudName: "nope" }))
    expect(Exit.isFailure(exit)).toBe(true)
  })
})

describe("loadCredentials", () => {
  it.effect("prefers OS_* env over clouds.yaml when OS_AUTH_URL is set", () =>
    Effect.gen(function*() {
      const credentials = yield* loadCredentials({
        OS_AUTH_URL: "https://keystone.example.com/v3",
        OS_REGION_NAME: "gra",
        OS_APPLICATION_CREDENTIAL_ID: "app-id",
        OS_APPLICATION_CREDENTIAL_SECRET: "app-secret"
      })
      expect(credentials.authUrl).toBe("https://keystone.example.com/v3")
    }))

  it("fails with AuthenticationFailed when no env and no clouds.yaml file is present", async () => {
    const exit = await Effect.runPromiseExit(
      loadCredentials({ OS_CLIENT_CONFIG_FILE: "/nonexistent/clouds.yaml" })
    )
    expect(Exit.isFailure(exit)).toBe(true)
  })
})
