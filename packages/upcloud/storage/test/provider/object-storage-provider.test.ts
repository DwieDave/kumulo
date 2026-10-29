import { assert, describe, it } from "@effect/vitest"
import { Effect, Predicate, Redacted } from "effect"
import { makeObjectStorageClient } from "@kumulo/upcloud"
import { ProviderApiError } from "@kumulo/core"
import { ensureService, ensureUserAccess, KUMULO_S3_POLICY, makeUpcloudObjectStorageProvider } from "../../src/provider/object-storage-provider.ts"
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

  it.live("deleteBucket decides from its own list, not from an earlier read", () =>
    Effect.gen(function*() {
      const { fake, provider } = _makeProvider()
      yield* provider.ensureBucket(_spec)
      const service = _theService(fake)
      const earlier = yield* provider.listBuckets(_region)
      assert.strictEqual(earlier.length, 1)
      const bucket = fake.buckets.get(service.uuid)?.get(_spec.name)

      if (bucket !== undefined) bucket.total_objects = 5
      const failure = yield* Effect.flip(provider.deleteBucket({ name: _spec.name, region: _region }))
      assert.strictEqual(failure._tag, "BucketNotEmpty")
      assert.isFalse(fake.buckets.get(service.uuid)?.get(_spec.name)?.deleted ?? true)
      assert.isFalse(fake.requests.some((r) => r.startsWith("DELETE") && r.includes("/buckets/")))
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

      if (Predicate.isTagged(failure, "BucketNotEmpty")) {
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

  it.live("ensureCredentials attaches the S3 policy once", () =>
    Effect.gen(function*() {
      const { fake, provider } = _makeProvider()
      yield* provider.ensureCredentials(_cluster)
      yield* provider.ensureCredentials(_cluster)
      const service = _theService(fake)
      assert.deepStrictEqual(fake.policies.get(`${service.uuid}/staging-kumulo`), [KUMULO_S3_POLICY])
      assert.strictEqual(KUMULO_S3_POLICY, "ECSS3FullAccess")
      assert.strictEqual(fake.requests.filter((r) => r.startsWith("POST") && r.endsWith("/policies")).length, 1)
    }))

  it.live("ensureUserAccess attaches the policy without rotating the access key", () =>
    Effect.gen(function*() {
      const { fake, provider } = _makeProvider()
      const creds = yield* provider.ensureCredentials(_cluster)
      const service = _theService(fake)
      fake.policies.delete(`${service.uuid}/staging-kumulo`)
      const client = makeObjectStorageClient(fake.httpClient)
      yield* ensureUserAccess({ client, cluster: _cluster, region: _region, pollInterval: "1 millis" })(_cluster)
      assert.deepStrictEqual(fake.policies.get(`${service.uuid}/staging-kumulo`), [KUMULO_S3_POLICY])
      const keys = [...(fake.accessKeys.get(`${service.uuid}/staging-kumulo`)?.keys() ?? [])]
      assert.deepStrictEqual(keys, [Redacted.value(creds.accessKey)])
    }))
})

describe("upcloud storage-upcloud provider — service states", () => {
  it.live("three concurrent ensureBucket calls with a shared service make one service create", () =>
    Effect.gen(function*() {
      const { fake } = _makeProvider()
      const client = makeObjectStorageClient(fake.httpClient)
      const options = { client, cluster: _cluster, region: _region, pollInterval: "1 millis" as const }
      const service = yield* ensureService(options)
      const provider = makeUpcloudObjectStorageProvider(options)
      yield* Effect.forEach(["a", "b", "c"], (name) => provider.ensureBucket({ ..._spec, name }, service), { concurrency: 4 })
      assert.strictEqual(fake.requests.filter((r) => r === "POST /1.3/object-storage-2").length, 1)
      assert.strictEqual(fake.buckets.get(service.uuid)?.size, 3)
    }))

  it.live("uses the api endpoint, not the static-website one", () =>
    Effect.gen(function*() {
      const { fake, provider } = _makeProvider()
      yield* provider.ensureBucket(_spec)
      const service = _theService(fake)
      service.runningEndpoints = [
        { domain_name: "web.example.com", type: "public", mode: "static-website" },
        { domain_name: "api.example.com", type: "public", mode: "api" }
      ]
      service.ladderIndex = 0
      service.operational_state = "setup-network"
      const info = yield* provider.ensureBucket(_spec)
      assert.strictEqual(info.endpoint, "api.example.com")
    }))

  it.live("restarts a stopped service and waits for it to run", () =>
    Effect.gen(function*() {
      const { fake, provider } = _makeProvider()
      fake.services.set("objsto-x", {
        uuid: "objsto-x",
        name: "staging-objsto",
        region: _region,
        configured_status: "stopped",
        operational_state: "stopped",
        ladderIndex: 0,
        endpoints: []
      })
      fake.buckets.set("objsto-x", new Map())
      yield* provider.ensureBucket(_spec)
      assert.strictEqual(fake.services.get("objsto-x")?.configured_status, "started")
      assert.strictEqual(fake.services.get("objsto-x")?.operational_state, "running")
      assert.isTrue(fake.requests.some((r) => r === "PATCH /1.3/object-storage-2/objsto-x"))
    }))

  it.live("fails at once for a service that is being deleted", () =>
    Effect.gen(function*() {
      const { fake, provider } = _makeProvider()
      fake.services.set("objsto-x", {
        uuid: "objsto-x",
        name: "staging-objsto",
        region: _region,
        configured_status: "started",
        operational_state: "delete-service",
        fixedState: "delete-service",
        ladderIndex: 0,
        endpoints: []
      })
      const error = yield* Effect.flip(provider.ensureBucket(_spec))
      assert.instanceOf(error, ProviderApiError)

      if (error instanceof ProviderApiError) assert.match(String(error.body), /delet/)
    }))

  it.live("waits for a deleted bucket of the same name to disappear before creating it", () =>
    Effect.gen(function*() {
      const { fake, provider } = _makeProvider()
      yield* provider.ensureBucket({ ..._spec, name: "other" })
      const service = _theService(fake)
      fake.buckets.get(service.uuid)?.set("b", {
        name: "b",
        total_objects: 0,
        total_size_bytes: 0,
        deleted: true,
        pollsUntilGone: 2
      })
      yield* provider.ensureBucket({ ..._spec, name: "b" })
      assert.strictEqual(fake.buckets.get(service.uuid)?.get("b")?.deleted, false)
    }))
})
