import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Effect, Layer } from "effect"
import * as BunServices from "@effect/platform-bun/BunServices"
import * as HttpClient from "effect/http/HttpClient"
import { assert, it } from "@effect/vitest"
import { Command } from "effect/cli"
import { kumuloCli } from "../../src/commands.ts"
import { DoctorFailed } from "../../src/doctor/failed.ts"
import { makeStorageClient } from "@kumulo/storage-ovh"
import { makeMksClient } from "@kumulo/distro-ovh-mks"
import { MksEnv } from "../../src/mks/env.ts"
import { StorageEnv } from "../../src/storage/env.ts"
import { unavailableUpcloudEnvLayer } from "../fake-upcloud-env.ts"
import { makeFakeCinder } from "./fake-cinder.ts"
import { OpenStackEnv } from "../../src/openstack/env.ts"
import { baseEncodedConfig } from "../fixtures.ts"

process.stdout.isTTY = false

const unreachable = HttpClient.make(() => Effect.die("must not be reached"))

const _path = () => {
  const path = join(mkdtempSync(join(tmpdir(), "kumulo-doctor-")), "cluster.json")
  writeFileSync(path, JSON.stringify(baseEncodedConfig))

  return path
}

const _env = Layer.mergeAll(
  Layer.succeed(OpenStackEnv, { keystone: undefined, region: undefined, unavailableReason: "no OS_* env" }),
  Layer.succeed(HttpClient.HttpClient, HttpClient.make(() => Effect.die("must not be reached"))),
  Layer.succeed(MksEnv, { mks: makeMksClient(unreachable), serviceName: "" }),
  Layer.succeed(StorageEnv, { storage: makeStorageClient(unreachable), serviceName: "" }),
  makeFakeCinder({}),
  unavailableUpcloudEnvLayer,
  BunServices.layer
)

it.effect("kumulo doctor runs the distro checks and fails when one fails", () =>
  Effect.gen(function*() {
    const error = yield* Command.runWith(kumuloCli, { version: "test" })(["doctor", _path()]).pipe(
      Effect.provide(_env),
      Effect.flip
    )

    assert.deepStrictEqual(error, new DoctorFailed({ failed: ["openstack-keystone-auth"] }))
  }))
