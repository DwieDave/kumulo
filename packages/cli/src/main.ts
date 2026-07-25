#!/usr/bin/env bun
import { BunRuntime } from "@effect/platform-bun"
import * as BunHttpClient from "@effect/platform-bun/BunHttpClient"
import * as BunServices from "@effect/platform-bun/BunServices"
import { ConfigProvider, Console, Effect, Layer, Option } from "effect"
import { CliError, Command } from "effect/unstable/cli"
import { ChildProcessSpawner as ChildProcessSpawnerNS } from "effect/unstable/process"
import { kumuloCli } from "./commands.ts"
import { resolveSecretsFile, secretsConfigProvider } from "./secrets-file.ts"
import { OpenStackEnvLive } from "./doctor-openstack/env.ts"
import { exitCodeFor } from "./exit-codes.ts"
import { renderCliError } from "./errors.ts"
import { MksEnvLive } from "./mks/env.ts"
import { StorageEnvLive } from "./storage/env.ts"
import { CinderAuthLive } from "./volumes/env.ts"

// Explicit Layer wiring at the composition root, no runtime module
// discovery. `OpenStackEnv` is never-failing (see its doc comment) so
// `doctor`'s OpenStack checks and the k3s command path share one Keystone
// auth/region source instead of each re-deriving it. `CinderAuthLive` is
// derived from that same `OpenStackEnv` (`Layer.provideMerge` keeps
// `OpenStackEnv` itself exposed too, since the doctor checks still need it
// directly) — volumes (Cinder) are a plain OpenStack service shared by both
// distros, no separate credential set. `StorageEnvLive` similarly depends on
// `MksEnv` (reuses its `serviceName`, see `storage/env.ts`) and is kept
// alongside it the same way. `HttpClient.HttpClient` stays in the exposed
// environment too (not just consumed while building the other layers) —
// `VolumeProvider`/`ObjectStorageProvider`/`CredentialsSink` are composed
// per-cluster at command runtime (`reconcileVolumesOnDelete`,
// `storageLayers`), not at Layer-build time, so they still need an ambient
// `HttpClient` to reach.
const MainLive = Layer.mergeAll(
  MksEnvLive,
  StorageEnvLive.pipe(Layer.provideMerge(MksEnvLive)),
  CinderAuthLive.pipe(Layer.provideMerge(OpenStackEnvLive)),
  BunHttpClient.layer
).pipe(Layer.provide(BunHttpClient.layer))

// `--secrets-file` is a real shared flag (visible in `--help`, see `root.ts`);
// `KUMULO_SECRETS_FILE` is the flagless fallback (R2). The credential layers
// above read `Config` while they are *built*, so they are provided per
// invocation via `Command.provide` — after parsing, once the flag value is
// known — with the sops provider layered underneath. `provideMerge` keeps the
// `ConfigProvider` exposed for handler-time `Config` reads too (`--show-env`,
// per-cluster storage layers). With no path configured the provider layer is
// empty and the default env provider stays in charge, byte-identical to
// before. The spawner is resolved from Bun services here and only here (N2) —
// `@kumulo/secrets-sops` stays runtime-agnostic.
const _liveFor = (secretsFile: string | undefined) => {
  const secretsProvider = secretsFile === undefined ? Layer.empty : ConfigProvider.layer(
    Effect.map(
      Effect.service(ChildProcessSpawnerNS.ChildProcessSpawner),
      (spawner) => secretsConfigProvider({ file: secretsFile, spawner })
    )
  ).pipe(Layer.provide(BunServices.layer))
  return MainLive.pipe(Layer.provideMerge(secretsProvider))
}

const cli = Command.provide(kumuloCli, ({ secretsFile }) =>
  _liveFor(resolveSecretsFile({ flag: Option.getOrUndefined(secretsFile), env: process.env })))

const program = Command.run(cli, { version: "0.0.0" }).pipe(
  Effect.provide(BunServices.layer),
  Effect.matchEffect({
    onFailure: (error) =>
      Effect.gen(function*() {
        const message = CliError.isCliError(error) ? error.message : renderCliError(error)
        yield* Console.error(message)
        process.exitCode = CliError.isCliError(error) ? 64 : exitCodeFor(error)
      }),
    onSuccess: () => Effect.void
  })
)

BunRuntime.runMain(program)
