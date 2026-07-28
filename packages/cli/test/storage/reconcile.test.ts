import { Effect, Layer, Redacted } from "effect"
import { layerNoop } from "effect/FileSystem"
import { assert, it } from "@effect/vitest"
import { CredentialsSink, ObjectStorageProvider, parseConfigYaml } from "@kumulo/core"
import type { BucketInfo, BucketRef, BucketSpec, ClusterTag, CredentialEntry } from "@kumulo/core"
import { stringifyOutputsYaml } from "@kumulo/storage-ovh"
import type { OutputsFile } from "@kumulo/storage-ovh"
import { bucketDeletePlanActions, bucketPlanActions, bucketStatus, convergeBuckets, reconcileBucketsOnDelete } from "../../src/storage/reconcile.ts"

const _yaml = (bucketsYaml: string) => `
name: staging
provider: ovh
distro: ovh-mks
version: "1.31.0"
auth:
  method: application_credential
  region: GRA5
api_server:
  high_availability: true
  allowed_cidrs: ["0.0.0.0/0"]
ssh:
  public_key_path: ~/.ssh/id_ed25519.pub
  allowed_cidrs: ["0.0.0.0/0"]
masters:
  flavor: b2-7
  count: 3
  image: ubuntu-22.04
worker_pools: []
dns:
  module: none
  zone: unused.example.com
  ttl: 300
  records: []
volumes:
  module: none
  managed: []
object_storage:
${bucketsYaml}
secrets:
  sink: sops
  dir: .
  sops:
    age_recipient: age1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq
addons:
  cloud_controller_manager: true
  cinder_csi:
    enabled: false
    default_volume_type: unused
  hcloud_csi:
    enabled: false
  system_upgrade_controller: false
  cni: flannel
k3s:
  extra_server_args: []
  extra_agent_args: []
`

const _oneBucketYaml = `  module: ovh
  buckets:
    - name: staging-eu-backups
      region: DE1
      versioning: false
      encryption: false
      retain: true`

const _noBucketsYaml = `  module: none
  buckets: []`

// `ovh` module with nothing currently desired — distinct from `module: none`,
// which this reconcile code treats as "don't touch buckets at all" (module
// switched off, not "every desired bucket was removed").
const _emptyBucketsOvhYaml = `  module: ovh
  buckets: []`

// in-memory FileSystem covering just `exists`/`readFileString`/`writeFileString`
// against a `Map`, seeded with an outputs file for the bucket-outputs path.
const _fakeFs = (seed: Record<string, string> = {}) => {
  const store = new Map(Object.entries(seed))
  return layerNoop({
    exists: (path) => Effect.succeed(store.has(path)),
    readFileString: (path) => Effect.succeed(store.get(path) ?? ""),
    writeFileString: (path, data) =>
      Effect.sync(() => {
        store.set(path, data)
      })
  })
}

const _outputsSeed = (dir: string, file: OutputsFile): Record<string, string> => ({
  [`${dir}/${file.cluster}.buckets.yaml`]: stringifyOutputsYaml(file)
})

const _bucketInfo = (ref: BucketRef): BucketInfo => ({ name: ref.name, region: ref.region, endpoint: `https://s3.${ref.region.toLowerCase()}.io.cloud.ovh.net` })

interface FakeProviderCalls {
  readonly ensureBucket: Array<BucketSpec>
  readonly deleteBucket: Array<BucketRef>
  readonly ensureCredentialsCalls: Array<ClusterTag>
  // Buckets that "exist on OVH" before the test runs — plan existence checks
  // and heal behavior read live state through listBuckets.
  readonly live?: Array<BucketRef>
}

const _fakeProviderLayer = (calls: FakeProviderCalls) =>
  Layer.succeed(
    ObjectStorageProvider,
    ObjectStorageProvider.of({
      listBuckets: (region) =>
        Effect.succeed(
          [...(calls.live ?? []), ...calls.ensureBucket]
            .filter((b) => b.region === region)
            .map(_bucketInfo)
        ),
      ensureBucket: (spec) => {
        calls.ensureBucket.push(spec)
        return Effect.succeed(_bucketInfo(spec))
      },
      deleteBucket: (ref) => {
        calls.deleteBucket.push(ref)
        return Effect.void
      },
      ensureCredentials: (clusterName) => {
        calls.ensureCredentialsCalls.push(clusterName)
        return Effect.succeed({
          user: `kumulo-${clusterName}`,
          accessKey: Redacted.make("AKIA"),
          secretKey: Redacted.make("secret"),
          buckets: []
        })
      }
    })
  )

const _fakeSinkLayer = (writes: Array<ReadonlyArray<CredentialEntry>>) =>
  Layer.succeed(
    CredentialsSink,
    CredentialsSink.of({
      write: (entries) => {
        writes.push(entries)
        return Effect.void
      }
    })
  )

it.effect("bucketPlanActions is empty when object_storage.module is none", () =>
  Effect.gen(function*() {
    const config = yield* parseConfigYaml(_yaml(_noBucketsYaml))
    const layer = Layer.merge(_fakeFs(), _fakeProviderLayer({ ensureBucket: [], deleteBucket: [], ensureCredentialsCalls: [] }))
    const actions = yield* bucketPlanActions({ config, configDir: "." }).pipe(Effect.provide(layer))
    assert.deepStrictEqual(actions, [])
  }))

it.effect("bucketPlanActions shows a Create for a bucket missing from recorded outputs", () =>
  Effect.gen(function*() {
    const config = yield* parseConfigYaml(_yaml(_oneBucketYaml))
    const layer = Layer.merge(_fakeFs(), _fakeProviderLayer({ ensureBucket: [], deleteBucket: [], ensureCredentialsCalls: [] }))
    const actions = yield* bucketPlanActions({ config, configDir: "." }).pipe(Effect.provide(layer))
    assert.deepStrictEqual(actions, [{ _tag: "Create", name: "bucket/staging-eu-backups" }])
  }))

it.effect("bucketPlanActions shows NoOp once outputs match desired", () =>
  Effect.gen(function*() {
    const config = yield* parseConfigYaml(_yaml(_oneBucketYaml))
    const seed = _outputsSeed(".", {
      cluster: "staging",
      buckets: [{ name: "staging-eu-backups", region: "DE1", versioning: false, encryption: false, retain: true }]
    })
    const layer = Layer.merge(
      _fakeFs(seed),
      _fakeProviderLayer({
        ensureBucket: [],
        deleteBucket: [],
        ensureCredentialsCalls: [],
        live: [{ name: "staging-eu-backups", region: "DE1" }]
      })
    )
    const actions = yield* bucketPlanActions({ config, configDir: "." }).pipe(Effect.provide(layer))
    assert.deepStrictEqual(actions, [{ _tag: "NoOp", name: "bucket/staging-eu-backups" }])
  }))

it.effect("bucketPlanActions shows ReplaceNeedsConfirm on immutable drift (encryption)", () =>
  Effect.gen(function*() {
    const config = yield* parseConfigYaml(_yaml(_oneBucketYaml))
    const seed = _outputsSeed(".", {
      cluster: "staging",
      buckets: [{ name: "staging-eu-backups", region: "DE1", versioning: false, encryption: true, retain: true }]
    })
    const layer = Layer.merge(_fakeFs(seed), _fakeProviderLayer({ ensureBucket: [], deleteBucket: [], ensureCredentialsCalls: [] }))
    const actions = yield* bucketPlanActions({ config, configDir: "." }).pipe(Effect.provide(layer))
    assert.strictEqual(actions.length, 1)
    assert.strictEqual(actions[0]?._tag, "ReplaceNeedsConfirm")
  }))

it.effect("bucketPlanActions shows a Delete for a non-retained bucket dropped from config", () =>
  Effect.gen(function*() {
    const config = yield* parseConfigYaml(_yaml(_emptyBucketsOvhYaml))
    const seed = _outputsSeed(".", {
      cluster: "staging",
      buckets: [{ name: "orphan", region: "DE1", versioning: false, encryption: false, retain: false }]
    })
    const layer = Layer.merge(_fakeFs(seed), _fakeProviderLayer({ ensureBucket: [], deleteBucket: [], ensureCredentialsCalls: [] }))
    const actions = yield* bucketPlanActions({ config, configDir: "." }).pipe(Effect.provide(layer))
    assert.deepStrictEqual(actions, [{ _tag: "Delete", name: "bucket/orphan" }])
  }))

it.effect("convergeBuckets creates missing buckets and issues credentials when none are recorded", () =>
  Effect.gen(function*() {
    const config = yield* parseConfigYaml(_yaml(_oneBucketYaml))
    const calls: FakeProviderCalls = { ensureBucket: [], deleteBucket: [], ensureCredentialsCalls: [] }
    const writes: Array<ReadonlyArray<CredentialEntry>> = []
    const layer = Layer.mergeAll(_fakeProviderLayer(calls), _fakeSinkLayer(writes), _fakeFs())

    yield* convergeBuckets({ config, configDir: "." }).pipe(Effect.provide(layer))

    assert.deepStrictEqual(calls.ensureBucket.map((b) => b.name), ["staging-eu-backups"])
    assert.deepStrictEqual(calls.ensureCredentialsCalls, ["staging"])
    assert.strictEqual(writes.length, 1)
    const [firstWrite = []] = writes
    const keys = firstWrite.map((e) => e.key)
    assert.include(keys, "s3.accessKey")
    assert.include(keys, "s3.buckets.0.name")
  }))

it.effect("convergeBuckets skips ensureCredentials when the credentials file already exists", () =>
  Effect.gen(function*() {
    const config = yield* parseConfigYaml(_yaml(_oneBucketYaml))
    const calls: FakeProviderCalls = { ensureBucket: [], deleteBucket: [], ensureCredentialsCalls: [] }
    const writes: Array<ReadonlyArray<CredentialEntry>> = []
    const fs = _fakeFs({ "./staging.credentials.yaml": "already-here" })
    const layer = Layer.mergeAll(_fakeProviderLayer(calls), _fakeSinkLayer(writes), fs)

    yield* convergeBuckets({ config, configDir: "." }).pipe(Effect.provide(layer))

    assert.deepStrictEqual(calls.ensureCredentialsCalls, [])
    assert.strictEqual(writes.length, 0)
  }))

it.effect("convergeBuckets keeps a retained orphan recorded but never deletes it", () =>
  Effect.gen(function*() {
    const config = yield* parseConfigYaml(_yaml(_emptyBucketsOvhYaml))
    const calls: FakeProviderCalls = { ensureBucket: [], deleteBucket: [], ensureCredentialsCalls: [] }
    const writes: Array<ReadonlyArray<CredentialEntry>> = []
    const seed = _outputsSeed(".", {
      cluster: "staging",
      buckets: [{ name: "keep-me", region: "DE1", versioning: false, encryption: false, retain: true }]
    })
    const layer = Layer.mergeAll(_fakeProviderLayer(calls), _fakeSinkLayer(writes), _fakeFs(seed))

    yield* convergeBuckets({ config, configDir: "." }).pipe(Effect.provide(layer))

    assert.deepStrictEqual(calls.deleteBucket, [])
  }))

it.effect("reconcileBucketsOnDelete deletes non-retained buckets and keeps retained ones", () =>
  Effect.gen(function*() {
    const config = yield* parseConfigYaml(_yaml(_emptyBucketsOvhYaml))
    const calls: FakeProviderCalls = { ensureBucket: [], deleteBucket: [], ensureCredentialsCalls: [] }
    const seed = _outputsSeed(".", {
      cluster: "staging",
      buckets: [
        { name: "keep-me", region: "DE1", versioning: false, encryption: false, retain: true },
        { name: "drop-me", region: "DE1", versioning: false, encryption: false, retain: false }
      ]
    })
    const layer = Layer.mergeAll(_fakeProviderLayer(calls), _fakeFs(seed))

    const result = yield* reconcileBucketsOnDelete({ config, configDir: "." }).pipe(Effect.provide(layer))

    assert.deepStrictEqual(result.kept, ["keep-me"])
    assert.deepStrictEqual(result.deleted, ["drop-me"])
    assert.deepStrictEqual(calls.deleteBucket, [{ name: "drop-me", region: "DE1" }])
  }))

it.effect("reconcileBucketsOnDelete no-ops when object_storage.module isn't ovh", () =>
  Effect.gen(function*() {
    const config = yield* parseConfigYaml(_yaml(_noBucketsYaml))
    const calls: FakeProviderCalls = { ensureBucket: [], deleteBucket: [], ensureCredentialsCalls: [] }
    const layer = Layer.mergeAll(_fakeProviderLayer(calls), _fakeFs())

    const result = yield* reconcileBucketsOnDelete({ config, configDir: "." }).pipe(Effect.provide(layer))

    assert.deepStrictEqual(result, { kept: [], deleted: [] })
    assert.deepStrictEqual(calls.deleteBucket, [])
  }))

it.effect("bucketStatus reports recorded buckets + whether the credentials file exists", () =>
  Effect.gen(function*() {
    const config = yield* parseConfigYaml(_yaml(_oneBucketYaml))
    const seed = {
      ..._outputsSeed(".", {
        cluster: "staging",
        buckets: [{ name: "staging-eu-backups", region: "DE1", versioning: false, encryption: false, retain: true }]
      }),
      "./staging.credentials.yaml": "ciphertext"
    }
    const info = yield* bucketStatus({ config, configDir: "." }).pipe(Effect.provide(_fakeFs(seed)))
    assert.strictEqual(info.credentialsExist, true)
    assert.deepStrictEqual(info.buckets.map((b) => b.name), ["staging-eu-backups"])
  }))

it.effect("bucketPlanActions plans Create for a recorded bucket deleted out-of-band", () =>
  Effect.gen(function*() {
    const config = yield* parseConfigYaml(_yaml(_oneBucketYaml))
    const seed = _outputsSeed(".", {
      cluster: "staging",
      buckets: [{ name: "staging-eu-backups", region: "DE1", versioning: false, encryption: false, retain: true }]
    })
    // No `live` seeding: OVH no longer has the bucket.
    const layer = Layer.merge(_fakeFs(seed), _fakeProviderLayer({ ensureBucket: [], deleteBucket: [], ensureCredentialsCalls: [] }))
    const actions = yield* bucketPlanActions({ config, configDir: "." }).pipe(Effect.provide(layer))
    assert.deepStrictEqual(actions, [{ _tag: "Create", name: "bucket/staging-eu-backups" }])
  }))

it.effect("convergeBuckets re-ensures recorded (noop) buckets so out-of-band deletions heal", () =>
  Effect.gen(function*() {
    const config = yield* parseConfigYaml(_yaml(_oneBucketYaml))
    const seed = _outputsSeed(".", {
      cluster: "staging",
      buckets: [{ name: "staging-eu-backups", region: "DE1", versioning: false, encryption: false, retain: true }]
    })
    const calls: FakeProviderCalls = { ensureBucket: [], deleteBucket: [], ensureCredentialsCalls: [] }
    const writes: Array<ReadonlyArray<CredentialEntry>> = []
    const layer = Layer.mergeAll(_fakeProviderLayer(calls), _fakeSinkLayer(writes), _fakeFs(seed))

    yield* convergeBuckets({ config, configDir: "." }).pipe(Effect.provide(layer))

    // The diff says noop, but the bucket still goes through ensureBucket.
    assert.deepStrictEqual(calls.ensureBucket.map((b) => b.name), ["staging-eu-backups"])
  }))

it.effect("bucketDeletePlanActions: Delete for non-retained, NoOp \"(retained)\" for retained", () =>
  Effect.gen(function*() {
    const config = yield* parseConfigYaml(_yaml(_emptyBucketsOvhYaml))
    const seed = _outputsSeed(".", {
      cluster: "staging",
      buckets: [
        { name: "drop-me", region: "DE1", versioning: false, encryption: false, retain: false },
        { name: "keep-me", region: "DE1", versioning: false, encryption: false, retain: true }
      ]
    })
    const actions = yield* bucketDeletePlanActions({ config, configDir: "." }).pipe(Effect.provide(_fakeFs(seed)))
    assert.deepStrictEqual(actions, [
      { _tag: "Delete", name: "bucket/drop-me" },
      { _tag: "NoOp", name: "bucket/keep-me (retained)" }
    ])
  }))
