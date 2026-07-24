import { AuthenticationFailed } from "@kumulo/core"
import { Effect } from "effect"
import { readFileSync } from "node:fs"
import { parse as parseYaml } from "yaml"

export interface ApplicationCredentialAuth {
  readonly method: "application_credential"
  readonly authUrl: string
  readonly applicationCredentialId: string
  readonly applicationCredentialSecret: string
  readonly region: string
}

export interface PasswordAuth {
  readonly method: "password"
  readonly authUrl: string
  readonly username: string
  readonly password: string
  readonly projectName: string
  readonly userDomain: string
  readonly projectDomain: string
  readonly region: string
}

export type OpenStackCredentials = ApplicationCredentialAuth | PasswordAuth

const _missing = (field: string): AuthenticationFailed =>
  new AuthenticationFailed({ hint: `missing required credential field: ${field}` })

const _require = (value: string | undefined, field: string): Effect.Effect<string, AuthenticationFailed> =>
  value === undefined || value === "" ? Effect.fail(_missing(field)) : Effect.succeed(value)

interface RawIdentity {
  readonly auth_url?: string
  readonly application_credential_id?: string
  readonly application_credential_secret?: string
  readonly username?: string
  readonly password?: string
  readonly project_name?: string
  readonly user_domain_name?: string
  readonly project_domain_name?: string
}

// kumulo: shared by env-var and clouds.yaml sources — both boil down to the
// same raw field bag, only the field names/casing differ at the call site.
const _fromRaw = (raw: RawIdentity, region: string): Effect.Effect<OpenStackCredentials, AuthenticationFailed> =>
  Effect.gen(function*() {
    const authUrl = yield* _require(raw.auth_url, "auth_url")
    if (raw.application_credential_id !== undefined) {
      const applicationCredentialId = yield* _require(raw.application_credential_id, "application_credential_id")
      const applicationCredentialSecret = yield* _require(
        raw.application_credential_secret,
        "application_credential_secret"
      )
      return { method: "application_credential", authUrl, applicationCredentialId, applicationCredentialSecret, region }
    }
    const username = yield* _require(raw.username, "username")
    const password = yield* _require(raw.password, "password")
    const projectName = yield* _require(raw.project_name, "project_name")
    const userDomain = raw.user_domain_name ?? "Default"
    const projectDomain = raw.project_domain_name ?? "Default"
    return { method: "password", authUrl, username, password, projectName, userDomain, projectDomain, region }
  })

export const credentialsFromEnv = (
  env: Readonly<Record<string, string | undefined>>
): Effect.Effect<OpenStackCredentials, AuthenticationFailed> =>
  Effect.gen(function*() {
    const region = yield* _require(env.OS_REGION_NAME, "OS_REGION_NAME")
    return yield* _fromRaw({
      auth_url: env.OS_AUTH_URL,
      application_credential_id: env.OS_APPLICATION_CREDENTIAL_ID,
      application_credential_secret: env.OS_APPLICATION_CREDENTIAL_SECRET,
      username: env.OS_USERNAME,
      password: env.OS_PASSWORD,
      project_name: env.OS_PROJECT_NAME,
      user_domain_name: env.OS_USER_DOMAIN_NAME,
      project_domain_name: env.OS_PROJECT_DOMAIN_NAME
    }, region)
  })

interface CloudsYaml {
  readonly clouds?: Record<string, { readonly auth?: RawIdentity; readonly region_name?: string }>
}

export interface CredentialsFromCloudsYamlOptions {
  readonly fileContents: string
  readonly cloudName: string
}

export const credentialsFromCloudsYaml = (
  options: CredentialsFromCloudsYamlOptions
): Effect.Effect<OpenStackCredentials, AuthenticationFailed> =>
  Effect.gen(function*() {
    const parsed: CloudsYaml = parseYaml(options.fileContents)
    const cloud = parsed.clouds?.[options.cloudName]
    if (cloud === undefined) return yield* Effect.fail(_missing(`clouds.${options.cloudName}`))
    const region = yield* _require(cloud.region_name, "region_name")
    return yield* _fromRaw(cloud.auth ?? {}, region)
  })

// kumulo: OS_* env wins if OS_AUTH_URL is set, else fall back to
// clouds.yaml (openstacksdk-compatible file+cloud lookup)
export const loadCredentials = (
  env: Readonly<Record<string, string | undefined>>
): Effect.Effect<OpenStackCredentials, AuthenticationFailed> => {
  if (env.OS_AUTH_URL !== undefined) return credentialsFromEnv(env)
  const path = env.OS_CLIENT_CONFIG_FILE ?? "clouds.yaml"
  const cloudName = env.OS_CLOUD ?? "default"
  return Effect.try({
    try: () => readFileSync(path, "utf8"),
    catch: () => _missing(`clouds.yaml at ${path}`)
  }).pipe(Effect.flatMap((contents) => credentialsFromCloudsYaml({ fileContents: contents, cloudName })))
}
