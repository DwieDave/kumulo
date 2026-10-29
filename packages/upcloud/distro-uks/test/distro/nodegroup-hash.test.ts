import { describe, expect, it } from "@effect/vitest"
import { Effect, Schema } from "effect"
import { UpcloudUksClusterConfig } from "../../src/config.ts"
import { parseTaint } from "../../src/distro/ensure-nodepools.ts"
import { KUMULO_POOL_LABEL_KEY, uksPoolHash, uksPoolName } from "../../src/distro/nodegroup-diff.ts"
import type { UksWorkerPoolConfig } from "../../src/distro/types.ts"

const _pool = (overrides: Partial<UksWorkerPoolConfig> = {}): UksWorkerPoolConfig => ({
  name: "workers",
  plan: "2xCPU-4GB",
  count: 3,
  ...overrides
})

describe("uksPoolHash", () => {
  it("is stable for the same immutable fields", () => {
    expect(uksPoolHash(_pool())).toBe(uksPoolHash(_pool()))
  })

  it("ignores count (mutable — PATCH can change it)", () => {
    expect(uksPoolHash(_pool({ count: 3 }))).toBe(uksPoolHash(_pool({ count: 9 })))
  })

  it("changes when any immutable field changes", () => {
    const base = uksPoolHash(_pool())
    expect(uksPoolHash(_pool({ plan: "4xCPU-8GB" }))).not.toBe(base)
    expect(uksPoolHash(_pool({ labels: [{ key: "env", value: "prod" }] }))).not.toBe(base)
    expect(uksPoolHash(_pool({ taints: ["a=b:NoSchedule"] }))).not.toBe(base)
    expect(uksPoolHash(_pool({ ssh_keys: ["ssh-ed25519 AAAA"] }))).not.toBe(base)
    expect(uksPoolHash(_pool({ storage: "10xCPU-100GB" }))).not.toBe(base)
    expect(uksPoolHash(_pool({ anti_affinity: true }))).not.toBe(base)
    expect(uksPoolHash(_pool({ utility_network_access: true }))).not.toBe(base)
  })

  it("is unaffected by the pool's own name (name is identity, not immutable-field drift)", () => {
    expect(uksPoolHash(_pool({ name: "workers" }))).toBe(uksPoolHash(_pool({ name: "spot" })))
  })
})

describe("uksPoolHash golden", () => {
  it("is unchanged for a pool with a bare taint and labels", () => {
    expect(uksPoolHash(_pool({ labels: [{ key: "role", value: "gpu" }], taints: ["gpu"] }))).toBe("0352581186545fcc")
  })
})

describe("parseTaint", () => {
  it("keeps the old bare form as an empty-value NoSchedule taint", () => {
    expect(parseTaint("gpu")).toEqual({ key: "gpu", value: "", effect: "NoSchedule" })
  })

  it("parses key=value:Effect", () => {
    expect(parseTaint("dedicated=gpu:NoExecute")).toEqual({ key: "dedicated", value: "gpu", effect: "NoExecute" })
  })

  it("parses key:Effect and key=value", () => {
    expect(parseTaint("gpu:PreferNoSchedule")).toEqual({ key: "gpu", value: "", effect: "PreferNoSchedule" })
    expect(parseTaint("a=b")).toEqual({ key: "a", value: "b", effect: "NoSchedule" })
  })
})

const _config = (pool: { readonly labels?: Readonly<Record<string, string>>; readonly taints?: ReadonlyArray<string> }) => ({
  name: "staging-eu",
  provider: "upcloud",
  distro: "upcloud-uks",
  version: "1.31",
  zone: "de-fra1",
  auth: { method: "api_token", region: "de-fra1" },
  network: { cidr: "10.0.0.0/16" },
  worker_pools: [{ name: "general", flavor: "2xCPU-4GB", count: 1, ...pool }],
  dns: { module: "none" },
  volumes: { module: "none" },
  object_storage: { module: "none" },
  secrets: { sink: "none" }
})

const _decode = (pool: { readonly labels?: Readonly<Record<string, string>>; readonly taints?: ReadonlyArray<string> }) => Effect.flip(Schema.decodeUnknownEffect(UpcloudUksClusterConfig)(_config(pool)))

describe("worker pool config", () => {
  it.effect("accepts valid taints", () =>
    Schema.decodeUnknownEffect(UpcloudUksClusterConfig)(_config({ taints: ["gpu", "dedicated=gpu:NoExecute"] })).pipe(Effect.asVoid))

  it.effect("rejects an unknown taint effect", () =>
    Effect.gen(function*() {
      const failure = yield* _decode({ taints: ["a:Bogus"] })
      expect(String(failure)).toContain("taints")
    }))

  it.effect("rejects kumulo- label keys", () =>
    Effect.gen(function*() {
      const failure = yield* _decode({ labels: { "kumulo-pool": "x" } })
      expect(String(failure)).toContain("kumulo- label keys are reserved")
    }))
})

describe("uksPoolName", () => {
  it("produces <pool>-<hash8> as the live API-visible name", () => {
    const pool = _pool()
    const live = uksPoolName(pool)
    const hash = uksPoolHash(pool)
    expect(live).toBe(`${pool.name}-${hash.slice(0, 8)}`)
    expect(live.length).toBeLessThanOrEqual(63)
  })

  it("differs when the immutable hash differs, stays put across mutable (count) drift", () => {
    const a = uksPoolName(_pool())
    const b = uksPoolName(_pool({ count: 99 }))
    expect(a).toBe(b)
    const c = uksPoolName(_pool({ plan: "4xCPU-8GB" }))
    expect(a).not.toBe(c)
  })

  it("exposes the kumulo-pool label key as a stable constant", () => {
    expect(KUMULO_POOL_LABEL_KEY).toBe("kumulo-pool")
  })
})
