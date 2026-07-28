import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { Effect } from "effect"
import { computePlan, decidePlanAction, parseConfigYaml, renderPlan, toTaggedResource } from "@kumulo/core"
import type { BucketSpec, ClusterConfig, DesiredResource, PlanAction, TaggedResource } from "@kumulo/core"
import { diffBuckets } from "@kumulo/storage-ovh"
import type { BucketDiff, ExistingBucket } from "@kumulo/storage-ovh"

// AC-1 — `kumulo create --config examples/... --dry-run` prints a correct
// plan against a fake CloudProvider inventory. Exercises the real
// compute/render pipeline (already unit-tested per-case in
// packages/core/test/plan) end-to-end against the example config's actual
// worker pools, for empty/partial/complete/drifted inventories.
const _desiredFor = (config: ClusterConfig): ReadonlyArray<DesiredResource> =>
  config.worker_pools.flatMap((pool) =>
    Array.from({ length: pool.count }, (_, index) => ({
      cluster: config.name,
      role: "worker" as const,
      pool: pool.name,
      index,
      spec: { flavor: pool.flavor }
    }))
  )

// R5 — buckets appear as plan actions alongside worker pools, same fake-
// inventory shape (empty/partial/complete/drifted). `desiredBuckets` is empty
// for `object_storage.module: none` (k3s), so these are no-ops there by
// construction — no distro branch needed here.
const _desiredBuckets = (config: ClusterConfig): ReadonlyArray<BucketSpec> =>
  config.object_storage.module === "none"
    ? []
    : config.object_storage.buckets.map((bucket) => ({
        name: bucket.name,
        region: bucket.region ?? config.auth.region,
        versioning: bucket.versioning,
        encryption: bucket.encryption,
        retain: bucket.retain
      }))

const _toExisting = (bucket: BucketSpec): ExistingBucket => ({ ...bucket })

// Mirrors `bucketPlanActions`'s diff -> action mapping in
// packages/cli/src/storage/reconcile.ts, duplicated (not imported) so this
// file stays decoupled from the CLI app layer — same precedent as
// `_desiredFor` above reimplementing worker-pool desired-state construction
// rather than importing it from `mks/plan.ts`/`k3s/plan.ts`.
const _bucketActions = (diff: BucketDiff): ReadonlyArray<PlanAction> => [
  ...diff.toCreate.map((b) => ({ _tag: "Create" as const, name: `bucket/${b.name}` })),
  ...diff.toUpdate.map((u) => ({ _tag: "Create" as const, name: `bucket/${u.spec.name}` })),
  ...diff.toReplace.map((r) => ({
    _tag: "ReplaceNeedsConfirm" as const,
    name: `bucket/${r.spec.name}`,
    reason: "region or encryption changed (immutable, delete+recreate)"
  })),
  ...diff.toDelete.map((ref) => ({ _tag: "Delete" as const, name: `bucket/${ref.name}` })),
  ...diff.noop.map((ref) => ({ _tag: "NoOp" as const, name: `bucket/${ref.name}` }))
]

// Mirrors `buildMksPlan`'s volume-action addition in
// packages/cli/src/mks/plan.ts — wired only into the ovh-mks CLI path,
// k3s already converges `volumes.managed` (`k3s/reconcile.ts`) without
// showing it in the plan, unchanged here. Same "always Create" caveat as
// `buildMksPlan`, so unlike `_bucketActions` this ignores the fake
// inventory entirely.
const _volumeActions = (config: ClusterConfig): ReadonlyArray<PlanAction> =>
  config.distro === "k3s" || config.volumes.module !== "cinder"
    ? []
    : config.volumes.managed.map((v) => ({ _tag: "Create" as const, name: `volume/${v.name}` }))

const _cases = [
  { file: "ovh-mks.yaml", label: "ovh-mks" },
  { file: "k3s.yaml", label: "k3s" },
  { file: "k3s-hetzner.yaml", label: "k3s-hetzner" },
  { file: "upcloud-uks.json", label: "upcloud-uks" }
] as const

for (const { file, label } of _cases) {
  const _config = Effect.runSync(parseConfigYaml(readFileSync(join(import.meta.dirname, file), "utf8")))
  const _desired = _desiredFor(_config)
  const _desiredBkts = _desiredBuckets(_config)

  // Combines worker-pool + bucket actions into one `Plan`, same shape as
  // `_applyFlow` in packages/cli/src/commands.ts (`[...basePlan.actions, ...bucketActions]`).
  const _fullPlan = (nodes: ReadonlyArray<TaggedResource>, buckets: ReadonlyArray<ExistingBucket>) => ({
    actions: [
      ...computePlan({ desired: _desired, actual: nodes }).actions,
      ..._volumeActions(_config),
      ..._bucketActions(diffBuckets({ desired: _desiredBkts, existing: buckets }))
    ]
  })

  describe(`dry-run plan against fake inventory (${label})`, () => {
    it("empty inventory -> all creates", () => {
      const plan = _fullPlan([], [])
      expect(decidePlanAction({ plan, yes: false, dryRun: true })).toEqual({ _tag: "DryRun" })
      expect(renderPlan(plan)).toMatchSnapshot()
    })

    it("partial inventory -> mix of no-op and create", () => {
      const nodes: ReadonlyArray<TaggedResource> = _desired.slice(0, 1).map(toTaggedResource)
      const buckets = _desiredBkts.slice(0, 1).map(_toExisting)
      expect(renderPlan(_fullPlan(nodes, buckets))).toMatchSnapshot()
    })

    it("complete matching inventory -> all no-ops, nothing to do (mks: except its always-Create volumes)", () => {
      const nodes: ReadonlyArray<TaggedResource> = _desired.map(toTaggedResource)
      const buckets = _desiredBkts.map(_toExisting)
      const plan = _fullPlan(nodes, buckets)
      // mks volume actions are always "Create" (no real diff yet, see
      // `_volumeActions`), so a fully-converged mks cluster with managed
      // volumes still needs confirmation — never silently "nothing to do".
      const expected = _volumeActions(_config).length > 0 ? { _tag: "NeedsConfirm" } : { _tag: "NothingToDo" }
      expect(decidePlanAction({ plan, yes: false, dryRun: false })).toEqual(expected)
      expect(renderPlan(plan)).toMatchSnapshot()
    })

    it("drifted inventory -> replace-needs-confirm, never a silent apply", () => {
      const nodes: ReadonlyArray<TaggedResource> = _desired.map((resource) => toTaggedResource({ ...resource, spec: { flavor: "drifted" } }))
      const buckets = _desiredBkts.map((bucket) => _toExisting({ ...bucket, encryption: !bucket.encryption }))
      const plan = _fullPlan(nodes, buckets)
      expect(decidePlanAction({ plan, yes: false, dryRun: false })).toEqual({ _tag: "NeedsConfirm" })
      expect(renderPlan(plan)).toMatchSnapshot()
    })
  })
}
