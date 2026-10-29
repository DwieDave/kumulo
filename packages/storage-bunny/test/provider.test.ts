import { Effect, Redacted, Schema } from "effect"
import { assert, describe, it } from "@effect/vitest"
import { BucketNotEmpty, ResourceConflict } from "@kumulo/core"
import { makeBunnyHttpClient, makeBunnyStorageClient, makeFakeBunnyStorage } from "@kumulo/bunny"
import { diffBuckets } from "../src/diff.ts"
import type { ExistingBunnyBucket } from "../src/diff.ts"
import { emptyOutputs, outputsPath, parseOutputsYaml, stringifyOutputs } from "../src/outputs.ts"
import type { OutputsBucket } from "../src/outputs.ts"
import { makeBunnyObjectStorageProvider } from "../src/provider.ts"

const _setup = (owned: ReadonlyArray<OutputsBucket> = []) => {
  const fake = makeFakeBunnyStorage({ apiKey: "k" })
  const http = makeBunnyHttpClient({ base: fake.httpClient, apiKey: Redacted.make("k"), baseUrl: "https://fake.invalid" })
  const storage = makeBunnyStorageClient(http)

  return { fake, storage, provider: makeBunnyObjectStorageProvider({ storage, owned }) }
}

const _spec = { name: "kumulo-data", region: "DE", retain: false }

describe("provider", () => {
  it.effect("creates a zone and reports the s3 endpoint", () =>
    Effect.gen(function*() {
      const { fake, provider } = _setup()
      const ensured = yield* provider.ensureZone(_spec)
      assert.strictEqual(fake.peek().length, 1)
      assert.strictEqual(ensured.info.endpoint, "https://de-s3.storage.bunnycdn.com")
      assert.strictEqual(ensured.bucket.id, fake.peek()[0]?.Id)
    }))

  it.effect("re-apply of an owned zone performs zero writes", () =>
    Effect.gen(function*() {
      const first = _setup()
      const ensured = yield* first.provider.ensureZone(_spec)
      const { fake, storage } = _setup()
      const seeded = fake.seed({ name: _spec.name })
      const provider = makeBunnyObjectStorageProvider({ storage, owned: [{ ...ensured.bucket, id: seeded.Id }] })
      yield* provider.ensureBucket(_spec)
      yield* provider.ensureBucket(_spec)
      assert.strictEqual(fake.writes().length, 0)
      assert.strictEqual(fake.peek().length, 1)
    }))

  it.effect("name collision with an unowned zone is a ResourceConflict", () =>
    Effect.gen(function*() {
      const { fake, provider } = _setup()
      fake.seed({ name: _spec.name })
      const error = yield* Effect.flip(provider.ensureBucket(_spec))
      assert.instanceOf(error, ResourceConflict)
      assert.strictEqual(fake.writes().length, 0)
    }))

  it.effect("refuses to delete a non-empty zone", () =>
    Effect.gen(function*() {
      const { fake, storage } = _setup()
      const seeded = fake.seed({ name: _spec.name, filesStored: 3 })

      const provider = makeBunnyObjectStorageProvider({
        storage,
        owned: [{ id: seeded.Id, name: _spec.name, region: "DE", tier: "standard", retain: false }]
      })

      const error = yield* Effect.flip(provider.deleteBucket({ name: _spec.name, region: "DE" }))
      assert.instanceOf(error, BucketNotEmpty)
      assert.strictEqual(fake.peek().length, 1)
    }))

  it.effect("deleting a zone that is already gone is a no-op", () =>
    Effect.gen(function*() {
      const { fake, storage } = _setup()

      const provider = makeBunnyObjectStorageProvider({
        storage,
        owned: [{ id: 99999, name: _spec.name, region: "DE", tier: "standard", retain: false }]
      })

      yield* provider.deleteBucket({ name: _spec.name, region: "DE" })
      assert.strictEqual(fake.writes().length, 0)
    }))

  it.effect("deletes an empty owned zone", () =>
    Effect.gen(function*() {
      const { fake, storage } = _setup()
      const seeded = fake.seed({ name: _spec.name })

      const provider = makeBunnyObjectStorageProvider({
        storage,
        owned: [{ id: seeded.Id, name: _spec.name, region: "DE", tier: "standard", retain: false }]
      })

      yield* provider.deleteBucket({ name: _spec.name, region: "DE" })
      assert.strictEqual(fake.peek().length, 0)
    }))

  it.effect("never deletes a retained zone", () =>
    Effect.gen(function*() {
      const { fake, storage } = _setup()
      const seeded = fake.seed({ name: _spec.name })

      const provider = makeBunnyObjectStorageProvider({
        storage,
        owned: [{ id: seeded.Id, name: _spec.name, region: "DE", tier: "standard", retain: true }]
      })

      yield* provider.deleteBucket({ name: _spec.name, region: "DE" })
      assert.strictEqual(fake.peek().length, 1)
      assert.strictEqual(fake.writes().length, 0)
    }))

  it.effect("returns per-bucket credentials from zone name and password", () =>
    Effect.gen(function*() {
      const { fake, storage } = _setup()
      const seeded = fake.seed({ name: _spec.name, region: "NY" })

      const provider = makeBunnyObjectStorageProvider({
        storage,
        owned: [{ id: seeded.Id, name: _spec.name, region: "NY", tier: "standard", retain: false }]
      })

      const creds = yield* provider.ensureCredentials("staging")
      const entry = creds.bucketCredentials?.[0]
      assert.strictEqual(entry?.name, _spec.name)
      assert.strictEqual(entry?.endpoint, "https://ny-s3.storage.bunnycdn.com")
      assert.strictEqual(Redacted.value(entry?.accessKey ?? Redacted.make("")), _spec.name)
      assert.strictEqual(Redacted.value(entry?.secretKey ?? Redacted.make("")), seeded.Password)
      assert.strictEqual(creds.buckets.length, 1)
    }))

  it.effect("lists owned zones in a region", () =>
    Effect.gen(function*() {
      const { fake, storage } = _setup()
      const mine = fake.seed({ name: "owned-zone", region: "DE" })
      fake.seed({ name: "other-zone", region: "DE" })

      const provider = makeBunnyObjectStorageProvider({
        storage,
        owned: [{ id: mine.Id, name: "owned-zone", region: "DE", tier: "standard", retain: false }]
      })

      const listed = yield* provider.listBuckets("DE")
      assert.deepStrictEqual(listed.map((bucket) => bucket.name), ["owned-zone"])
    }))

  it.effect("an unavailable (invalid) name is a ResourceConflict and writes nothing", () =>
    Effect.gen(function*() {
      const { fake, provider } = _setup()
      const error = yield* Effect.flip(provider.ensureBucket({ name: "x", region: "DE", retain: false }))
      assert.instanceOf(error, ResourceConflict)
      assert.strictEqual(fake.writes().length, 0)
    }))
})

const _bucketArb = Schema.Struct({
  name: Schema.Literals(["data-one", "data-two", "archive"]),
  region: Schema.Literals(["DE", "NY"]),
  tier: Schema.Literals(["standard", "edge"]),
  retain: Schema.Boolean
})

type BucketLike = Pick<ExistingBunnyBucket, "name" | "region" | "tier" | "retain">

const _toExisting = (bucket: BucketLike, id: number): ExistingBunnyBucket => ({ ...bucket, id })

describe("diffBuckets", () => {
  it.prop("a converged state diffs to a no-op", [Schema.Array(_bucketArb).check(Schema.isMaxLength(4))], ([buckets]) => {
    const desired = [...new Map(buckets.map((bucket) => [bucket.name, bucket])).values()]
    const diff = diffBuckets({ desired, existing: desired.map(_toExisting) })
    assert.strictEqual(diff.toCreate.length, 0)
    assert.strictEqual(diff.toReplace.length, 0)
    assert.strictEqual(diff.toDelete.length, 0)
    assert.strictEqual(diff.noop.length, desired.length)
  })

  it.prop("applying the diff then re-diffing is idempotent", [Schema.Array(_bucketArb).check(Schema.isMaxLength(4)), Schema.Array(_bucketArb).check(Schema.isMaxLength(4))], ([a, b]) => {
    const dedupe = (items: typeof a) => [...new Map(items.map((bucket) => [bucket.name, bucket])).values()]
    const desired = dedupe(a)
    const existing = dedupe(b).map(_toExisting)
    const first = diffBuckets({ desired, existing })
    const deleted = new Set(first.toDelete.map((ref) => ref.name))

    const applied = [
      ...existing.filter((bucket) => !deleted.has(bucket.name) && !first.toReplace.some((r) => r.ref.name === bucket.name)),
      ...[...first.toCreate, ...first.toReplace.map((r) => r.spec)].map((spec, i) => _toExisting({ ...spec, tier: spec.tier ?? "standard" }, 900 + i))
    ]

    const second = diffBuckets({ desired, existing: applied })
    assert.strictEqual(second.toCreate.length, 0)
    assert.strictEqual(second.toReplace.length, 0)
    assert.strictEqual(second.toDelete.length, 0)
  })

  it("never deletes retained buckets", () => {
    const diff = diffBuckets({ desired: [], existing: [{ id: 1, name: "keep", region: "DE", tier: "standard", retain: true }] })
    assert.strictEqual(diff.toDelete.length, 0)
  })

  it("replaces on region change", () => {
    const diff = diffBuckets({
      desired: [{ name: "a-zone", region: "NY", retain: false }],
      existing: [{ id: 1, name: "a-zone", region: "DE", tier: "standard", retain: false }]
    })

    assert.strictEqual(diff.toReplace.length, 1)
  })
})

describe("outputs", () => {
  it.effect("round-trips yaml", () =>
    Effect.gen(function*() {
      const file = { ...emptyOutputs("staging"), buckets: [{ id: 7, name: "a-zone", region: "DE", tier: "edge" as const, retain: true }] }
      const parsed = yield* parseOutputsYaml(stringifyOutputs({ file }))
      assert.deepStrictEqual(parsed, file)
      assert.strictEqual(outputsPath({ dir: "/x/", tag: "staging" }), "/x/staging.buckets.yaml")
    }))
})
