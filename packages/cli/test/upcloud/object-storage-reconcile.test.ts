import { assert, it } from "@effect/vitest"
import { Effect, Layer, Sink, Stream } from "effect"
import { layerNoop } from "effect/FileSystem"
import { ChildProcess, ChildProcessSpawner as ChildProcessSpawnerNS } from "effect/process"
import { makeObjectStorageClient } from "@kumulo/upcloud"
import { makeFakeObjectStorageServer } from "../../../upcloud/storage/test/provider/fake-object-storage-server.ts"
import { validUpcloudUksConfig } from "../config/fixtures.ts"
import { decodeUpcloudTestConfig } from "../fixtures.ts"
import { UpcloudEnv } from "../../src/upcloud/env.ts"
import { convergeUpcloudBuckets } from "../../src/upcloud/storage.ts"
import { unavailableUpcloudEnvLayer } from "../fake-upcloud-env.ts"

const _config = (bucketNames: ReadonlyArray<string>) =>
  decodeUpcloudTestConfig({
    ...validUpcloudUksConfig,
    secrets: { sink: "sops", dir: ".secrets", sops: { age_recipient: "age1test" } },
    object_storage: { module: "upcloud", region: "europe-1", buckets: bucketNames.map((name) => ({ name, retain: true })) }
  })

const _credsPath = ".secrets/staging-eu.credentials.yaml"

const _existingPlaintext = JSON.stringify({
  cluster: "staging-eu",
  s3: { user: "staging-eu-kumulo", accessKey: "OLDKEY", secretKey: "OLDSECRET", buckets: [{ name: "logs", endpoint: "old.example.com" }] }
})

const _setup = (options: { readonly credsExist: boolean }) => {
  const fake = makeFakeObjectStorageServer()
  const files = new Map<string, string>()
  const encrypted: Array<string> = []

  if (options.credsExist) files.set(_credsPath, "ENCRYPTED")

  const fs = layerNoop({
    exists: (path) => Effect.succeed(files.has(path)),
    writeFileString: (path, data) => Effect.sync(() => void files.set(path, data))
  })

  const spawner = ChildProcessSpawnerNS.make((command) =>
    Effect.gen(function*() {
      const isEncrypt = ChildProcess.isStandardCommand(command) && command.args.includes("--encrypt")
      const stdin = ChildProcess.isStandardCommand(command) ? command.options.stdin : undefined
      const plaintext = isEncrypt && Stream.isStream(stdin) ? yield* Stream.mkString(Stream.decodeText(stdin)) : ""

      if (isEncrypt) encrypted.push(plaintext)
      const stdout = isEncrypt ? `ENCRYPTED\n${plaintext}` : _existingPlaintext

      return ChildProcessSpawnerNS.makeHandle({
        pid: ChildProcessSpawnerNS.ProcessId(1),
        exitCode: Effect.succeed(ChildProcessSpawnerNS.ExitCode(0)),
        isRunning: Effect.succeed(false),
        kill: () => Effect.void,
        stdin: Sink.drain,
        stdout: Stream.encodeText(Stream.make(stdout)),
        stderr: Stream.encodeText(Stream.make("")),
        all: Stream.encodeText(Stream.make(stdout)),
        getInputFd: () => Sink.drain,
        getOutputFd: () => Stream.empty,
        unref: Effect.succeed(Effect.void)
      })
    })
  )

  const layer = Layer.mergeAll(
    fs,
    Layer.succeed(ChildProcessSpawnerNS.ChildProcessSpawner, spawner),
    Layer.effect(
      UpcloudEnv,
      Effect.map(UpcloudEnv, (env) => ({ ...env, objectStorage: makeObjectStorageClient(fake.httpClient) })).pipe(
        Effect.provide(unavailableUpcloudEnvLayer)
      )
    )
  )

  return { fake, files, encrypted, layer }
}

const _accessKeyCreates = (requests: ReadonlyArray<string>): number =>
  requests.filter((r) => r.startsWith("POST") && r.endsWith("/access-keys")).length

it.live("first apply with three buckets makes exactly one service create and writes the creds", () =>
  Effect.gen(function*() {
    const { fake, files, encrypted, layer } = _setup({ credsExist: false })
    yield* convergeUpcloudBuckets(_config(["logs-a", "logs-b", "logs-c"])).pipe(Effect.provide(layer))
    assert.strictEqual(fake.requests.filter((r) => r === "POST /1.3/object-storage-2").length, 1)
    assert.strictEqual(encrypted.length, 1)
    assert.include(encrypted[0], "name: logs-c")
    assert.isTrue(files.has(_credsPath))
    const service = [...fake.services.values()][0]
    assert.deepStrictEqual(fake.policies.get(`${service?.uuid}/staging-eu-kumulo`), ["ECSS3FullAccess"])
  }), { timeout: 30_000 })

it.live("re-run with a creds file attaches the missing policy, keeps the key, and rewrites the bucket entries", () =>
  Effect.gen(function*() {
    const { fake, encrypted, layer } = _setup({ credsExist: true })
    yield* convergeUpcloudBuckets(_config(["logs"])).pipe(Effect.provide(layer))
    assert.strictEqual(_accessKeyCreates(fake.requests), 0)
    const service = [...fake.services.values()][0]
    assert.deepStrictEqual(fake.policies.get(`${service?.uuid}/staging-eu-kumulo`), ["ECSS3FullAccess"])

    yield* convergeUpcloudBuckets(_config(["logs", "newbucket"])).pipe(Effect.provide(layer))
    assert.strictEqual(_accessKeyCreates(fake.requests), 0)
    const last = encrypted.at(-1) ?? ""
    assert.include(last, "secretKey: OLDSECRET")
    assert.include(last, "accessKey: OLDKEY")
    assert.include(last, "name: newbucket")
    assert.notInclude(last, "old.example.com")
  }), { timeout: 30_000 })
