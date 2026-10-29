import { Effect, Layer, Redacted } from "effect"
import * as HttpClient from "effect/http/HttpClient"
import { layerNoop } from "effect/FileSystem"
import { assert, describe, it } from "@effect/vitest"
import { BucketNotEmpty, CredentialsSink, ObjectStorageProvider, PlanAction } from "@kumulo/core"
import type { CredentialEntry } from "@kumulo/core"
import { makeBunnyHttpClient, makeBunnyStorageClient, makeFakeBunnyStorage } from "@kumulo/bunny"
import { bunnyObjectStorageProviderLive, outputsPath, parseOutputsYaml } from "@kumulo/storage-bunny"
import { makeStorageClient } from "@kumulo/storage-ovh"
import type { ClusterConfig } from "../../src/cluster-config.ts"
import { BunnyStorage, StorageEnv, storageProviderLayer } from "../../src/storage/env.ts"
import {
  bucketDeletePlanActions,
  bucketPlanActions,
  bucketStatus,
  convergeBuckets,
  reconcileBucketsOnDelete
} from "../../src/storage/reconcile.ts"
import { wantsObjectStorage } from "../../src/distro/registry.ts"
import { fakeCredentials } from "../commands/fake-credentials.ts"
import { baseEncodedConfig, baseMksEncodedConfig, decodeTestConfig } from "../fixtures.ts"

interface TestBucket {
  readonly name: string
  readonly region: "DE" | "NY"
  readonly retain: boolean
}

const _buckets: ReadonlyArray<TestBucket> = [
  { name: "kumulo-data", region: "DE", retain: false },
  { name: "kumulo-keep", region: "NY", retain: true }
]

const _sops = { sink: "sops", dir: ".", sops: { age_recipient: "age1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq" } } as const

const _k3s = (buckets: ReadonlyArray<TestBucket> = _buckets) =>
  decodeTestConfig({ ...baseEncodedConfig, object_storage: { module: "bunny", buckets }, secrets: _sops })

const _mks = decodeTestConfig({
  ...baseMksEncodedConfig,
  object_storage: { module: "bunny", buckets: _buckets },
  secrets: _sops
})

const _setup = (apiKey = "k") => {
  const fake = makeFakeBunnyStorage({ apiKey })
  const http = makeBunnyHttpClient({ base: fake.httpClient, apiKey: Redacted.make(apiKey), baseUrl: "https://fake.invalid" })
  const storage = makeBunnyStorageClient(http)
  const store = new Map<string, string>()
  const writes: Array<ReadonlyArray<CredentialEntry>> = []

  const fs = layerNoop({
    exists: (path) => Effect.succeed(store.has(path)),
    readFileString: (path) => Effect.succeed(store.get(path) ?? ""),
    writeFileString: (path, data) => Effect.sync(() => void store.set(path, data))
  })

  const sink = Layer.succeed(CredentialsSink, CredentialsSink.of({ write: (entries) => Effect.sync(() => void writes.push(entries)) }))
  const base = Layer.mergeAll(fs, sink, Layer.succeed(BunnyStorage, { storage }))

  const withProvider = (config: ClusterConfig) =>
    storageProviderLayer({ config, configDir: "." }).pipe(
      Effect.provide(Layer.mergeAll(
        fs,
        Layer.succeed(HttpClient.HttpClient, fake.httpClient),
        Layer.succeed(StorageEnv, { storage: makeStorageClient(fake.httpClient), serviceName: "s" })
      ))
    )

  return { fake, storage, store, writes, base, fs, withProvider }
}

const _ctx = { configDir: "." }

describe("bunny storage wiring", () => {
  it("wantsObjectStorage accepts bunny on every distro", () => {
    assert.isTrue(wantsObjectStorage(_k3s()))
    assert.isTrue(wantsObjectStorage(_mks))
  })

  it.effect("plan then apply creates zones, records outputs and writes per-bucket credentials", () =>
    Effect.gen(function*() {
      const { base, fake, store, writes, storage } = _setup()
      const config = _k3s()
      const provider = bunnyObjectStorageProviderLive({ storage, owned: [] })
      const plan = yield* bucketPlanActions({ config, ..._ctx }).pipe(Effect.provide(Layer.merge(provider, base)))
      assert.deepStrictEqual(plan, [
        PlanAction.Create({ name: "bucket/kumulo-data" }),
        PlanAction.Create({ name: "bucket/kumulo-keep" })
      ])

      yield* convergeBuckets({ config, ..._ctx }).pipe(Effect.provide(Layer.merge(provider, base)))
      assert.strictEqual(fake.peek().length, 2)

      const outputs = yield* parseOutputsYaml(store.get(outputsPath({ dir: ".", tag: config.name })) ?? "")
      assert.deepStrictEqual(outputs.buckets.map((b) => b.name), ["kumulo-data", "kumulo-keep"])

      assert.strictEqual(writes.length, 1)
      const keys = (writes[0] ?? []).map((entry) => entry.key)
      assert.deepStrictEqual(keys.slice(0, 6), [
        "cluster",
        "s3.buckets.0.name",
        "s3.buckets.0.region",
        "s3.buckets.0.endpoint",
        "s3.buckets.0.accessKey",
        "s3.buckets.0.secretKey"
      ])
      assert.include(keys, "s3.buckets.1.secretKey")
      const secret = (writes[0] ?? []).find((entry) => entry.key === "s3.buckets.0.secretKey")
      assert.strictEqual(secret === undefined ? "" : Redacted.value(secret.value), `pw-${fake.peek()[0]?.Id}`)
    }))

  it.effect("second apply performs zero writes and no credential rewrite", () =>
    Effect.gen(function*() {
      const { base, fake, writes, storage, store } = _setup()
      const config = _mks
      const first = bunnyObjectStorageProviderLive({ storage, owned: [] })
      yield* convergeBuckets({ config, ..._ctx }).pipe(Effect.provide(Layer.merge(first, base)))
      store.set("./prod-eu.credentials.yaml", "enc")
      const before = fake.writes().length
      yield* convergeBuckets({ config, ..._ctx }).pipe(Effect.provide(Layer.merge(first, base)))
      assert.strictEqual(fake.writes().length, before)
      assert.strictEqual(writes.length, 1)
    }))

  it.effect("status, delete plan and delete honour retain and empty zones", () =>
    Effect.gen(function*() {
      const { base, fake, store, storage } = _setup()
      const config = _k3s()
      const empty = bunnyObjectStorageProviderLive({ storage, owned: [] })
      yield* convergeBuckets({ config, ..._ctx }).pipe(Effect.provide(Layer.merge(empty, base)))

      const status = yield* bucketStatus({ config, ..._ctx }).pipe(Effect.provide(base))
      assert.deepStrictEqual(status.buckets.map((b) => b.name), ["kumulo-data", "kumulo-keep"])

      const deletePlan = yield* bucketDeletePlanActions({ config, ..._ctx }).pipe(Effect.provide(base))
      assert.deepStrictEqual(deletePlan, [
        PlanAction.Delete({ name: "bucket/kumulo-data" }),
        PlanAction.NoOp({ name: "bucket/kumulo-keep (retained)" })
      ])

      const owned = (yield* parseOutputsYaml(store.get(outputsPath({ dir: ".", tag: config.name })) ?? "")).buckets
      const live = bunnyObjectStorageProviderLive({ storage, owned })
      const result = yield* reconcileBucketsOnDelete({ config, ..._ctx }).pipe(Effect.provide(Layer.merge(live, base)))
      assert.deepStrictEqual(result, { kept: ["kumulo-keep"], deleted: ["kumulo-data"] })
      assert.deepStrictEqual(fake.peek().map((z) => z.Name), ["kumulo-keep"])

      const after = yield* bucketStatus({ config, ..._ctx }).pipe(Effect.provide(base))
      assert.deepStrictEqual(after.buckets.map((b) => b.name), ["kumulo-keep"])
    }))

  it.effect("delete refuses a non-empty zone before any delete call", () =>
    Effect.gen(function*() {
      const { fake, storage } = _setup()
      const seeded = fake.seed({ name: "kumulo-data", filesStored: 3 })
      const owned = [{ id: seeded.Id, name: "kumulo-data", region: "DE", tier: "standard" as const, retain: false }]
      const live = bunnyObjectStorageProviderLive({ storage, owned })
      const provider = yield* Effect.provide(ObjectStorageProvider, live)
      const error = yield* Effect.flip(provider.deleteBucket({ name: "kumulo-data", region: "DE" }))
      assert.instanceOf(error, BucketNotEmpty)
      assert.strictEqual(fake.peek().length, 1)
    }))

  it.effect("storageProviderLayer builds the bunny provider from BUNNYNET_API_KEY", () =>
    Effect.gen(function*() {
      const { fake, withProvider } = _setup("test-bunny-key")
      fake.seed({ name: "kumulo-data" })
      const layer = yield* withProvider(_k3s())
      const provider = yield* Effect.provide(ObjectStorageProvider, layer)
      const listed = yield* provider.listBuckets("DE")
      assert.deepStrictEqual(listed, [])
    }).pipe(Effect.provide(fakeCredentials)))
  it.effect("writes outputs for the successful buckets when one ensureZone fails, then fails", () =>
    Effect.gen(function*() {
      const { base, fake, store, storage } = _setup()
      fake.seed({ name: "kumulo-keep" })
      const config = _k3s()
      const provider = bunnyObjectStorageProviderLive({ storage, owned: [] })
      const error = yield* Effect.flip(convergeBuckets({ config, ..._ctx }).pipe(Effect.provide(Layer.merge(provider, base))))
      assert.ok(error !== undefined)
      const outputs = yield* parseOutputsYaml(store.get(outputsPath({ dir: ".", tag: config.name })) ?? "")
      assert.deepStrictEqual(outputs.buckets.map((b) => b.name), ["kumulo-data"])
    }))
})
