#!/usr/bin/env node
import { NodeRuntime } from "@effect/platform-node"
import * as NodeServices from "@effect/platform-node/NodeServices"
import { ConfigProvider, Console, Effect, Layer, Option } from "effect"
import { CliError, Command } from "effect/unstable/cli"
import * as HttpClient from "effect/unstable/http/HttpClient"
import { HttpClientError, TransportError } from "effect/unstable/http/HttpClientError"
import { makeMksClient } from "@kumulo/distro-ovh-mks"
import { makeStorageClient } from "@kumulo/storage-ovh"
import {
  makeNetworkClient,
  makeNodeGroupsClient,
  makeObjectStorageClient,
  makeRouterClient,
  makeStorageClient as makeUpcloudStorageClient,
  makeUksClient,
  makeZoneClient
} from "@kumulo/upcloud"
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

const _unavailable = (hint: string): HttpClient.HttpClient =>
  HttpClient.make((request) => Effect.fail(new HttpClientError({ reason: new TransportError({ request, description: hint }) })))

// env-missing fallback clients fail lazily on first request instead of at layer build,
// so an OVH-less run doesn't die before planning; upgrade to Effect-typed fields like `CinderAuth` if needed.
const _mksLive = Layer.catchCause(
  MksEnvLive,
  () => Layer.succeed(MksEnv, { mks: makeMksClient(_unavailable(OVH_HINT)), serviceName: "" })
)
const _storageLive = Layer.catchCause(
  StorageEnvLive.pipe(Layer.provide(_mksLive)),
  () => Layer.succeed(StorageEnv, { storage: makeStorageClient(_unavailable(OVH_HINT)), serviceName: "" })
)
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
      zones: makeZoneClient(_unavailable(UPCLOUD_HINT)),
      storage: makeUpcloudStorageClient(_unavailable(UPCLOUD_HINT)),
      objectStorage: makeObjectStorageClient(_unavailable(UPCLOUD_HINT))
    })
)

// Resolved once: every `HttpClient` in the process must be the same layer, and the runtime cannot change mid-run.
const _platformHttp = platformHttpClient()

const MainLive = Layer.mergeAll(
  _mksLive,
  _storageLive,
  _upcloudLive,
  CinderAuthLive.pipe(Layer.provideMerge(OpenStackEnvLive)),
  _platformHttp
).pipe(Layer.provide(_platformHttp))

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
