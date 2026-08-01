import { assert, it } from "@effect/vitest"
import { decodeUpcloudTestConfig } from "../fixtures.ts"
import { validUpcloudUksConfig } from "../config/fixtures.ts"
import { buildUpcloudPlan, uksClusterRow } from "../../src/upcloud/plan.ts"
import type { UpcloudInventory } from "../../src/upcloud/plan.ts"
import { volumePlanActions, uksVolumeRow } from "../../src/upcloud/volumes.ts"
import { bucketPlanActions, uksBucketRow } from "../../src/upcloud/storage.ts"

const _withVolumes = decodeUpcloudTestConfig({
  ...validUpcloudUksConfig,
  volumes: {
    module: "upcloud",
    managed: [
      { name: "data", size_gb: 10, type: "maxiops", retain: false },
      { name: "kept", size_gb: 5, type: "standard", retain: true }
    ]
  }
})

const _withBuckets = decodeUpcloudTestConfig({
  ...validUpcloudUksConfig,
  secrets: { sink: "sops", dir: ".secrets", sops: { age_recipient: "age1test" } },
  object_storage: {
    module: "upcloud",
    region: "europe-1",
    buckets: [
      { name: "logs", retain: false },
      { name: "backups", retain: true }
    ]
  }
})

it("plans Create for a managed volume with no matching live storage", () => {
  const actions = volumePlanActions({ config: _withVolumes, live: [] })
  assert.deepStrictEqual(actions, [
    { _tag: "Create", name: uksVolumeRow("data") },
    { _tag: "Create", name: uksVolumeRow("kept") }
  ])
})

it("plans NoOp for a managed volume whose live tier matches", () => {
  const actions = volumePlanActions({
    config: _withVolumes,
    live: [{ name: "data", tier: "maxiops" }, { name: "kept", tier: "standard" }]
  })
  assert.deepStrictEqual(actions, [
    { _tag: "NoOp", name: uksVolumeRow("data") },
    { _tag: "NoOp", name: uksVolumeRow("kept") }
  ])
})

it("refuses a changed tier as ReplaceNeedsConfirm, not a silent NoOp/Update", () => {
  const actions = volumePlanActions({ config: _withVolumes, live: [{ name: "data", tier: "standard" }, { name: "kept", tier: "standard" }] })
  const drift = actions.find((a) => a.name === uksVolumeRow("data"))
  assert.strictEqual(drift?._tag, "ReplaceNeedsConfirm")
  if (drift?._tag === "ReplaceNeedsConfirm") assert.include(drift.reason, "immutable")
})

it("plans Create for a configured bucket with no live match, NoOp when it exists", () => {
  const noLive = bucketPlanActions({ config: _withBuckets, live: [] })
  assert.deepStrictEqual(noLive, [
    { _tag: "Create", name: uksBucketRow("logs") },
    { _tag: "Create", name: uksBucketRow("backups") }
  ])
  const withLive = bucketPlanActions({
    config: _withBuckets,
    live: [{ name: "logs", region: "europe-1", endpoint: "logs.example" }, { name: "backups", region: "europe-1", endpoint: "backups.example" }]
  })
  assert.deepStrictEqual(withLive, [
    { _tag: "NoOp", name: uksBucketRow("logs") },
    { _tag: "NoOp", name: uksBucketRow("backups") }
  ])
})

it("buildUpcloudPlan appends volume and bucket rows to the cluster plan", () => {
  const config = decodeUpcloudTestConfig({
    ..._withVolumes,
    object_storage: _withBuckets.object_storage,
    secrets: _withBuckets.secrets
  })
  const inventory: UpcloudInventory = { clusterExists: false, nodeGroups: [], networkExists: false }
  const plan = buildUpcloudPlan({ config, inventory })
  const names = plan.actions.map((a) => a.name)
  assert.include(names, uksVolumeRow("data"))
  assert.include(names, uksBucketRow("logs"))
})

it("upcloudDeletePlanActions orders buckets and volumes ahead of the cluster row, retained ones as NoOp", () => {
  const config = decodeUpcloudTestConfig({
    ..._withVolumes,
    object_storage: _withBuckets.object_storage,
    secrets: _withBuckets.secrets
  })
  const bucketRows = config.object_storage.module === "upcloud"
    ? config.object_storage.buckets.map((b) =>
      b.retain
        ? { _tag: "NoOp" as const, name: `${uksBucketRow(b.name)} (retained)` }
        : { _tag: "Delete" as const, name: uksBucketRow(b.name) }
    )
    : []
  assert.deepStrictEqual(bucketRows, [
    { _tag: "Delete", name: uksBucketRow("logs") },
    { _tag: "NoOp", name: `${uksBucketRow("backups")} (retained)` }
  ])
  assert.isTrue(uksClusterRow(config.name).startsWith("uks-cluster/"))
})
