#!/usr/bin/env node
import { NodeRuntime } from "@effect/platform-node"
import * as NodeServices from "@effect/platform-node/NodeServices"
import { ConfigProvider, Console, Effect, Layer, Option } from "effect"
import { CliError, Command } from "effect/unstable/cli"
import * as HttpClient from "effect/unstable/http/HttpClient"
import { HttpClientError, TransportError } from "effect/unstable/http/HttpClientError"
import { makeMksClient } from "@kumulo/distro-ovh-mks"
import { makeStorageClient } from "@kumulo/storage-ovh"
import { makeNetworkClient, makeNodeGroupsClient, makeRouterClient, makeUksClient, makeZoneClient } from "@kumulo/upcloud"
import { ChildProcessSpawner as ChildProcessSpawnerNS } from "effect/unstable/process"
import { kumuloCli } from "./commands.ts"
import { resolveSecretsFile, secretsConfigProvider } from "./secrets-file.ts"
import { OpenStackEnvLive } from "./doctor-openstack/env.ts"
import { exitCodeFor } from "./exit-codes.ts"
import { renderCliError } from "./errors.ts"
import { MksEnv, MksEnvLive } from "./mks/env.ts"
import { StorageEnv, StorageEnvLive } from "./storage/env.ts"
import { UpcloudEnv, UpcloudEnvLive } from "./upcloud/env.ts"
import { platformHttpClient } from "./runtime-http.ts"
import { CinderAuthLive } from "./volumes/env.ts"
import packageJson from "../package.json" with { type: "json" }

const OVH_HINT = "OVH credentials unavailable (OVH_CLIENT_ID / OVH_CLIENT_SECRET / OVH_SERVICE_NAME)"
const UPCLOUD_HINT = "UpCloud credentials unavailable (UPCLOUD_API_TOKEN)"

/** An `HttpClient` that fails every request — see `_mksLive` below. */
const _unavailable = (hint: string): HttpClient.HttpClient =>
  HttpClient.make((request) => Effect.fail(new HttpClientError({ reason: new TransportError({ request, description: hint }) })))

// ponytail: `MksEnv`/`StorageEnv` read OVH env vars while they are *built*, so
// a hetzner-only k3s run used to die on a missing `OVH_SERVICE_NAME` before it
// could even plan. With the OVH env absent the services are still provided,
// backed by a client that fails on first request — the error now surfaces on
// the OVH code path that needs it, not on every command. Upgrade path: give
// both shapes Effect-typed fields like `CinderAuth` and drop these fallbacks.
const _mksLive = Layer.catchCause(
  MksEnvLive,
  () => Layer.succeed(MksEnv, { mks: makeMksClient(_unavailable(OVH_HINT)), serviceName: "" })
)
const _storageLive = Layer.catchCause(
  StorageEnvLive.pipe(Layer.provide(_mksLive)),
  () => Layer.succeed(StorageEnv, { storage: makeStorageClient(_unavailable(OVH_HINT)), serviceName: "" })
)
// Same shape as `_mksLive`: a k3s/ovh-mks run must not die on a missing
// `UPCLOUD_API_TOKEN` before it even plans — the fallback client fails on
// first request, surfacing on the upcloud-uks code path that actually needs it.
const _upcloudLive = Layer.catchCause(
  UpcloudEnvLive,
  () =>
    Layer.succeed(UpcloudEnv, {
      clients: {
        uks: makeUksClient(_unavailable(UPCLOUD_HINT)),
        nodeGroups: makeNodeGroupsClient(_unavailable(UPCLOUD_HINT)),
        network: makeNetworkClient(_unavailable(UPCLOUD_HINT)),
        router: makeRouterClient(_unavailable(UPCLOUD_HINT))
      },
      zones: makeZoneClient(_unavailable(UPCLOUD_HINT))
    })
)

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
// Resolved once: every `HttpClient` in the process must be the same layer, and
// the runtime cannot change mid-run.
const _platformHttp = platformHttpClient()

const MainLive = Layer.mergeAll(
  _mksLive,
  _storageLive,
  _upcloudLive,
  CinderAuthLive.pipe(Layer.provideMerge(OpenStackEnvLive)),
  _platformHttp
).pipe(Layer.provide(_platformHttp))

// `--secrets-file` is a real shared flag (visible in `--help`, see `root.ts`);
// `KUMULO_SECRETS_FILE` is the flagless fallback (R2). The credential layers
// above read `Config` while they are *built*, so they are provided per
// invocation via `Command.provide` — after parsing, once the flag value is
// known — with the sops provider layered underneath. `provideMerge` keeps the
// `ConfigProvider` exposed for handler-time `Config` reads too (`--show-env`,
// per-cluster storage layers). With no path configured the provider layer is
// empty and the default env provider stays in charge, byte-identical to
// before. The spawner is resolved from Node services here and only here (N2) —
// `@kumulo/secrets-sops` stays runtime-agnostic.
const _liveFor = (secretsFile: string | undefined) => {
  const secretsProvider = secretsFile === undefined ? Layer.empty : ConfigProvider.layer(
    Effect.map(
      Effect.service(ChildProcessSpawnerNS.ChildProcessSpawner),
      (spawner) => secretsConfigProvider({ file: secretsFile, spawner })
    )
  ).pipe(Layer.provide(NodeServices.layer))
  return MainLive.pipe(Layer.provideMerge(secretsProvider))
}

const cli = Command.provide(kumuloCli, ({ secretsFile }) =>
  _liveFor(resolveSecretsFile({ flag: Option.getOrUndefined(secretsFile), env: process.env })))

const program = Command.run(cli, { version: packageJson.version }).pipe(
  Effect.provide(NodeServices.layer),
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

NodeRuntime.runMain(program)
