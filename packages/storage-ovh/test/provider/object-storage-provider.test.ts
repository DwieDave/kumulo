import { assert, describe, it } from "@effect/vitest"
import { Effect, Redacted } from "effect"
import { makeOvhObjectStorageProvider } from "../../src/provider/object-storage-provider.ts"
import { makeFakeProject } from "./fake-project.ts"

const _serviceName = "kumulo-project"
const _spec = { name: "staging-eu-backups", region: "DE1", versioning: false, encryption: false, retain: true }

describe("ovh storage-ovh provider — buckets", () => {
  it.effect("ensureBucket creates a bucket that doesn't exist yet", () =>
    Effect.gen(function*() {
      const fake = makeFakeProject(_serviceName)
      const provider = makeOvhObjectStorageProvider({ storage: fake.storage, serviceName: _serviceName })
      const info = yield* provider.ensureBucket(_spec)
      assert.strictEqual(info.name, _spec.name)
      assert.strictEqual(info.region, _spec.region)
      assert.isDefined(fake.peekContainer(_spec.region, _spec.name))
    }))

  it.effect("ensureBucket is idempotent: a second call makes no further changes", () =>
    Effect.gen(function*() {
      const fake = makeFakeProject(_serviceName)
      const provider = makeOvhObjectStorageProvider({ storage: fake.storage, serviceName: _serviceName })
      yield* provider.ensureBucket(_spec)
      yield* provider.ensureBucket(_spec)
      assert.strictEqual(fake.peekContainer(_spec.region, _spec.name)?.versioning, "disabled")
    }))

  it.effect("ensureBucket updates versioning in place when it drifts from spec", () =>
    Effect.gen(function*() {
      const fake = makeFakeProject(_serviceName)
      fake.seedContainer({ name: _spec.name, region: _spec.region, versioning: "disabled" })
      const provider = makeOvhObjectStorageProvider({ storage: fake.storage, serviceName: _serviceName })
      yield* provider.ensureBucket({ ..._spec, versioning: true })
      assert.strictEqual(fake.peekContainer(_spec.region, _spec.name)?.versioning, "enabled")
    }))

  it.effect("listBuckets returns buckets in the given region", () =>
    Effect.gen(function*() {
      const fake = makeFakeProject(_serviceName)
      fake.seedContainer({ name: "a", region: "DE1" })
      fake.seedContainer({ name: "b", region: "GRA" })
      const provider = makeOvhObjectStorageProvider({ storage: fake.storage, serviceName: _serviceName })
      const buckets = yield* provider.listBuckets("DE1")
      assert.deepStrictEqual(buckets.map((b) => b.name), ["a"])
    }))

  it.effect("deleteBucket removes an empty bucket", () =>
    Effect.gen(function*() {
      const fake = makeFakeProject(_serviceName)
      fake.seedContainer({ name: _spec.name, region: _spec.region })
      const provider = makeOvhObjectStorageProvider({ storage: fake.storage, serviceName: _serviceName })
      yield* provider.deleteBucket({ name: _spec.name, region: _spec.region })
      assert.isUndefined(fake.peekContainer(_spec.region, _spec.name))
    }))

  it.effect("deleteBucket refuses a non-empty bucket with BucketNotEmpty { bucket, objectCount }", () =>
    Effect.gen(function*() {
      const fake = makeFakeProject(_serviceName)
      fake.seedContainer({ name: _spec.name, region: _spec.region, objectCount: 3 })
      const provider = makeOvhObjectStorageProvider({ storage: fake.storage, serviceName: _serviceName })
      const failure = yield* Effect.flip(provider.deleteBucket({ name: _spec.name, region: _spec.region }))
      assert.strictEqual(failure._tag, "BucketNotEmpty")
      if (failure._tag === "BucketNotEmpty") {
        assert.strictEqual(failure.bucket, _spec.name)
        assert.strictEqual(failure.objectCount, 3)
      }
      assert.isDefined(fake.peekContainer(_spec.region, _spec.name))
    }))
})

describe("ovh storage-ovh provider — credentials", () => {
  it.effect("ensureCredentials creates the user + a fresh credential on first run", () =>
    Effect.gen(function*() {
      const fake = makeFakeProject(_serviceName)
      const provider = makeOvhObjectStorageProvider({ storage: fake.storage, serviceName: _serviceName })
      const creds = yield* provider.ensureCredentials("staging")
      assert.strictEqual(creds.user, "kumulo-staging")
      assert.strictEqual(Redacted.value(creds.accessKey).length > 0, true)
      assert.strictEqual(Redacted.value(creds.secretKey).length > 0, true)
      assert.strictEqual(fake.userCount(), 1)
    }))

  it.effect("ensureCredentials reuses an existing user (matched by description) instead of creating another", () =>
    Effect.gen(function*() {
      const fake = makeFakeProject(_serviceName)
      fake.seedUser("kumulo-staging")
      const provider = makeOvhObjectStorageProvider({ storage: fake.storage, serviceName: _serviceName })
      yield* provider.ensureCredentials("staging")
      assert.strictEqual(fake.userCount(), 1)
    }))

  it.effect("ensureCredentials rotates an orphaned credential (deletes it, issues a fresh one)", () =>
    Effect.gen(function*() {
      const fake = makeFakeProject(_serviceName)
      const userId = fake.seedUser("kumulo-staging")
      fake.seedCredential(userId)
      const provider = makeOvhObjectStorageProvider({ storage: fake.storage, serviceName: _serviceName })
      const creds = yield* provider.ensureCredentials("staging")
      // The orphan's secret is unrecoverable, so it must be replaced, not kept.
      assert.notStrictEqual(Redacted.value(creds.accessKey), `AK-${userId}-seed`)
      assert.strictEqual(fake.credentialCount(userId), 1)
    }))
})
