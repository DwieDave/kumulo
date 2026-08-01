import { assert, describe, it } from "@effect/vitest"
import { Effect, Redacted } from "effect"
import { makeObjectStorageClient } from "@kumulo/upcloud"
import { makeUpcloudObjectStorageProvider } from "../../src/provider/object-storage-provider.ts"
import { makeFakeObjectStorageServer } from "./fake-object-storage-server.ts"

const _cluster = "staging"
const _region = "europe-1"
const _spec = { name: "staging-backups", region: _region, versioning: false, encryption: false, retain: true }

const _makeProvider = (options?: { readonly privateNetworkUuid?: string }) => {
  const fake = makeFakeObjectStorageServer()
  const client = makeObjectStorageClient(fake.httpClient)
  const provider = makeUpcloudObjectStorageProvider({ client, cluster: _cluster, region: _region, pollInterval: "1 millis", ...options })
  return { fake, provider }
}

const _theService = (fake: ReturnType<typeof makeFakeObjectStorageServer>) => {
  const service = [...fake.services.values()][0]
  if (service === undefined) throw new Error("expected a fake service to exist")
  return service
}

describe("upcloud storage-upcloud provider — service + buckets", () => {
  it.live("ensureBucket creates the D6 service (public + private networks), polls it running, then creates the bucket", () =>
    Effect.gen(function*() {
      const { fake, provider } = _makeProvider({ privateNetworkUuid: "net-1" })
      const info = yield* provider.ensureBucket(_spec)
      assert.strictEqual(info.name, _spec.name)
      assert.strictEqual(info.region, _region)
      assert.isTrue(info.endpoint.length > 0)
      const service = _theService(fake)
      assert.strictEqual(service.name, "staging-objsto")
      assert.strictEqual(service.operational_state, "running")
      assert.deepStrictEqual(
        service.networks?.map((n) => n.type).toSorted(),
        ["private", "public"]
      )
      assert.isDefined(fake.buckets.get(service.uuid)?.get(_spec.name))
    }))

  it.live("ensureBucket is idempotent: a second call reuses the service and doesn't recreate the bucket", () =>
    Effect.gen(function*() {
      const { fake, provider } = _makeProvider()
      yield* provider.ensureBucket(_spec)
      yield* provider.ensureBucket(_spec)
      assert.strictEqual(fake.services.size, 1)
      const service = _theService(fake)
      assert.strictEqual(fake.buckets.get(service.uuid)?.size, 1)
    }))

  it.live("listBuckets filters out async-deleting entries (deleted: true, R11)", () =>
    Effect.gen(function*() {
      const { fake, provider } = _makeProvider()
      yield* provider.ensureBucket(_spec)
      const service = _theService(fake)
      fake.buckets.get(service.uuid)?.set("ghost", {
        name: "ghost",
        total_objects: 0,
        total_size_bytes: 0,
        deleted: true,
        pollsUntilGone: 5
      })
      const buckets = yield* provider.listBuckets(_region)
      assert.deepStrictEqual(buckets.map((b) => b.name), [_spec.name])
    }))

  it.live("deleteBucket removes an empty bucket", () =>
    Effect.gen(function*() {
      const { fake, provider } = _makeProvider()
      yield* provider.ensureBucket(_spec)
      const service = _theService(fake)
      yield* provider.deleteBucket({ name: _spec.name, region: _region })
      assert.isTrue(fake.buckets.get(service.uuid)?.get(_spec.name)?.deleted ?? true)
    }))

  it.live("deleteBucket maps a non-empty bucket to BucketNotEmpty", () =>
    Effect.gen(function*() {
      const { fake, provider } = _makeProvider()
      yield* provider.ensureBucket(_spec)
      const service = _theService(fake)
      const bucket = fake.buckets.get(service.uuid)?.get(_spec.name)
      if (bucket !== undefined) bucket.total_objects = 3
      const failure = yield* Effect.flip(provider.deleteBucket({ name: _spec.name, region: _region }))
      assert.strictEqual(failure._tag, "BucketNotEmpty")
      if (failure._tag === "BucketNotEmpty") {
        assert.strictEqual(failure.bucket, _spec.name)
        assert.strictEqual(failure.objectCount, 3)
      }
    }))
})

describe("upcloud storage-upcloud provider — credentials", () => {
  it.live("ensureCredentials creates the user + a fresh access key on first run", () =>
    Effect.gen(function*() {
      const { fake, provider } = _makeProvider()
      const creds = yield* provider.ensureCredentials(_cluster)
      assert.strictEqual(creds.user, "staging-kumulo")
      assert.isTrue(Redacted.value(creds.accessKey).length > 0)
      assert.isTrue(Redacted.value(creds.secretKey).length > 0)
      const service = _theService(fake)
      assert.strictEqual(fake.accessKeys.get(`${service.uuid}/staging-kumulo`)?.size, 1)
    }))

  it.live("ensureCredentials rotates when a key already exists (secret unavailable on re-run)", () =>
    Effect.gen(function*() {
      const { fake, provider } = _makeProvider()
      const first = yield* provider.ensureCredentials(_cluster)
      const second = yield* provider.ensureCredentials(_cluster)
      const service = _theService(fake)
      assert.strictEqual(fake.accessKeys.get(`${service.uuid}/staging-kumulo`)?.size, 1)
      assert.notStrictEqual(Redacted.value(first.accessKey), Redacted.value(second.accessKey))
    }))
})
