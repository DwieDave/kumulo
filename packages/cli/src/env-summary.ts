import { Config, Effect, Option, Redacted } from "effect"
import { AuthenticationFailed } from "@kumulo/core"
import type { ClusterConfig } from "./cluster-config.ts"
import { distroFor, distroRegistry } from "./distro/registry.ts"
import { providerFor } from "./provider/registry.ts"
import { OS_ENV_KEYS, OS_SECRET_ENV_KEYS } from "./doctor-openstack/env.ts"
import { dim } from "./present.ts"

export interface ProviderSection {
  readonly title: string
  readonly vars: ReadonlyArray<string>
}

const _ovhVars = distroRegistry["ovh-mks"].requiredEnvVars
const _upcloudVars = distroRegistry["upcloud-uks"].requiredEnvVars
const _osVars = [...OS_ENV_KEYS, ...OS_SECRET_ENV_KEYS] as const

const _dnsVars: Record<ClusterConfig["dns"]["module"], ReadonlyArray<string>> = {
  none: [],
  ovh: ["OVH_CLIENT_ID", "OVH_CLIENT_SECRET"],
  hetzner: ["HETZNER_DNS_TOKEN"]
}

const _volumesVars: Record<ClusterConfig["volumes"]["module"], ReadonlyArray<string>> = {
  none: [],
  cinder: _osVars,
  hcloud: ["HCLOUD_TOKEN"],
  upcloud: ["UPCLOUD_API_TOKEN"]
}

const _objectStorageVars: Record<ClusterConfig["object_storage"]["module"], ReadonlyArray<string>> = {
  none: [],
  ovh: _ovhVars,
  upcloud: ["UPCLOUD_API_TOKEN"]
}

const _moduleSection = (
  title: string,
  vars: ReadonlyArray<string>
): ReadonlyArray<ProviderSection> => vars.length === 0 ? [] : [{ title, vars }]

export const providerSections = (config: ClusterConfig): ReadonlyArray<ProviderSection> => [
  providerFor(config).credentialsFromDistro
    ? {
      title: `provider: ${config.provider} (${distroFor(config).credentialsLabel})`,
      vars: distroFor(config).requiredEnvVars
    }
    : { title: `provider: ${config.provider}`, vars: providerFor(config).requiredEnvVars },
  ..._moduleSection(`dns: ${config.dns.module}`, _dnsVars[config.dns.module]),
  ..._moduleSection(`volumes: ${config.volumes.module}`, _volumesVars[config.volumes.module]),
  ..._moduleSection(`object_storage: ${config.object_storage.module}`, _objectStorageVars[config.object_storage.module])
]

export const renderEnvSummary = (
  { present, sections }: {
    readonly sections: ReadonlyArray<ProviderSection>
    readonly present: (name: string) => boolean
  }
): string =>
  [
    "Providers:",
    ...sections.flatMap((section) => [
      `  ${section.title}`,
      ...section.vars.map((name) =>
        present(name) ? `    ${name}=${Redacted.make("")}` : dim(`    ${name} (not set)`)
      )
    ])
  ].join("\n")

const _requiredVars = (config: ClusterConfig): ReadonlyArray<string> => [
  ...new Set([
    ...(config.distro === "ovh-mks" ? distroRegistry["ovh-mks"].requiredEnvVars : []),
    ...(config.distro === "upcloud-uks" ? _upcloudVars : []),
    ..._dnsVars[config.dns.module],
    ..._objectStorageVars[config.object_storage.module]
  ])
]

// Without this, a missing OVH_SERVICE_NAME silently produces `GET /cloud/project//kube` instead of a clear error.
export const missingCredentials = (
  { config, present }: { readonly config: ClusterConfig; readonly present: (name: string) => boolean }
): ReadonlyArray<string> => _requiredVars(config).filter((name) => !present(name))

export const requireCredentials = (config: ClusterConfig): Effect.Effect<void, AuthenticationFailed> =>
  Effect.gen(function*() {
    const names = _requiredVars(config)
    const entries = yield* Effect.all(
      names.map((name) =>
        Config.option(Config.redacted(name)).pipe(Effect.map((value) => [name, Option.isSome(value)] as const))
      )
    ).pipe(Effect.orDie)
    const set = new Map(entries)
    const missing = missingCredentials({ config, present: (name) => set.get(name) === true })
    if (missing.length === 0) return
    return yield* Effect.fail(
      new AuthenticationFailed({
        hint: `missing required environment variable${missing.length === 1 ? "" : "s"}: ${
          missing.join(", ")
        } — export them, or pass --secrets-file (see --show-env for everything this config reads)`
      })
    )
  })

export const envSummary = (config: ClusterConfig): Effect.Effect<string> =>
  Effect.gen(function*() {
    const sections = providerSections(config)
    const names = [...new Set(sections.flatMap((section) => section.vars))]
    const entries = yield* Effect.all(
      names.map((name) =>
        Config.option(Config.redacted(name)).pipe(Effect.map((value) => [name, Option.isSome(value)] as const))
      )
    ).pipe(Effect.orDie)
    const set = new Map(entries)
    return renderEnvSummary({ sections, present: (name) => set.get(name) === true })
  })
