import { Config, Effect, Option, Redacted } from "effect"
import type { ClusterConfig } from "@kumulo/core"
import { distroFor, distroRegistry } from "./distro/registry.ts"
import { providerFor } from "./provider/registry.ts"
import { OS_ENV_KEYS, OS_SECRET_ENV_KEYS } from "./doctor-openstack/env.ts"
import { dim } from "./present.ts"

export interface ProviderSection {
  readonly title: string
  readonly vars: ReadonlyArray<string>
}

const _ovhVars = distroRegistry["ovh-mks"].requiredEnvVars
// The full OS_* set `loadCredentials` reads — same keys the OpenStack doctor
// checks source. Only some are required (depends on auth.method); presence is
// shown for all so the operator sees which auth path will be picked.
const _osVars = [...OS_ENV_KEYS, ...OS_SECRET_ENV_KEYS] as const

// Per-module env vars. Adding a module literal breaks compilation here until
// its vars are listed (empty = no section). `dns: ovh` deliberately omits
// OVH_SERVICE_NAME — the DNS API is account-scoped, not project-scoped.
const _dnsVars: Record<ClusterConfig["dns"]["module"], ReadonlyArray<string>> = {
  none: [],
  ovh: ["OVH_CLIENT_ID", "OVH_CLIENT_SECRET"],
  hetzner: ["HETZNER_DNS_TOKEN"]
}

const _volumesVars: Record<ClusterConfig["volumes"]["module"], ReadonlyArray<string>> = {
  none: [],
  cinder: _osVars,
  hcloud: ["HCLOUD_TOKEN"]
}

const _objectStorageVars: Record<ClusterConfig["object_storage"]["module"], ReadonlyArray<string>> = {
  none: [],
  ovh: _ovhVars
}

const _moduleSection = (
  title: string,
  vars: ReadonlyArray<string>
): ReadonlyArray<ProviderSection> => vars.length === 0 ? [] : [{ title, vars }]

/** Which providers this config wires and the env vars each one reads (sourced from the distro/provider registries). */
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

/** Pure render given each var's presence — value display is always Effect `Redacted` (never the raw value). */
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

/** Env-var presence for `renderEnvSummary`, read via `Config` (not raw `process.env`), redacted end to end. */
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
