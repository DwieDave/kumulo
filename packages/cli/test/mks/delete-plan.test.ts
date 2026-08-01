import { Effect, Layer } from "effect"
import { FastCheck as fc } from "effect/testing"
import { assert, it } from "@effect/vitest"
import { makeMksClient } from "@kumulo/distro-ovh-mks"
import type { MksClusterConfigEncoded } from "../../src/cluster-config.ts"
import { mksEntry } from "../../src/distro/mks-entry.ts"
import { MksEnv } from "../../src/mks/env.ts"
import { OpenStackEnv } from "../../src/doctor-openstack/env.ts"
import { unavailableUpcloudEnvLayer } from "../fake-upcloud-env.ts"
import { makeFakeMksServer } from "../e2e/fake-mks-server.ts"
import { makeFakeCinder } from "../commands/fake-cinder.ts"
import { baseMksEncodedConfig, decodeMksTestConfig } from "../fixtures.ts"

const _openStackEnvLayer = Layer.succeed(OpenStackEnv, {
  keystone: undefined,
  region: undefined,
  unavailableReason: "the delete plan must not reach OpenStack"
})

// T5.2/R18. The teardown deletes the network unconditionally (D3: it is fully
// reproducible from the config, unlike a volume's or a bucket's contents), so
// its plan row is always a `Delete` and never the `(retained)` NoOp the volume
// and bucket rows use.

const _network = { cidr: "10.0.0.0/16", nodes_subnet: "10.0.1.0/24", load_balancers_subnet: "10.0.2.0/24" }

const _encoded = (
  { ingress, network }: { readonly network: boolean; readonly ingress: boolean }
): MksClusterConfigEncoded => ({
  ...baseMksEncodedConfig,
  name: "c1",
  worker_pools: [],
  ...(network ? { network: _network } : {}),
  ...(ingress ? { ingress: {} } : {})
})

/** `deletePlanActions` against a live cluster with no node pools. */
const _rows = (encoded: MksClusterConfigEncoded) =>
  Effect.gen(function*() {
    const server = makeFakeMksServer()
    server.clusters.set("kube-1", { id: "kube-1", name: "c1", status: "READY", url: "https://kube-1.fixture.mks.invalid" })
    server.pools.set("kube-1", new Map())
    return yield* mksEntry.deletePlanActions(decodeMksTestConfig(encoded)).pipe(
      Effect.provide(Layer.succeed(MksEnv, { mks: makeMksClient(server.httpClient), serviceName: "service-1" })),
      // The distro service set is shared across distros; a plan for an
      // `ovh-mks` config must reach neither of these.
      Effect.provide(makeFakeCinder({})),
      Effect.provide(_openStackEnvLayer),
      Effect.provide(unavailableUpcloudEnvLayer)
    )
  })

it.effect("the delete plan lists every resource the teardown removes, in teardown order", () =>
  Effect.gen(function*() {
    const rows = yield* _rows(_encoded({ network: true, ingress: true }))
    assert.deepStrictEqual(rows.map((row) => row.name), [
      "mks-cluster/c1",
      "load-balancer/c1/ingress",
      "floating-ip/c1/ingress",
      "subnet/c1/nodes",
      "subnet/c1/load-balancers",
      "network/c1"
    ])
    assert.deepStrictEqual(new Set(rows.map((row) => row._tag)), new Set(["Delete"]))
  }))

// Property: every infra row follows the `network` block, because that is the
// only thing `_deleteMksInfra` gates on — `deleteByTag` then deletes the LB and
// releases the floating IP by name, whether or not the config still declares an
// `ingress:` block. A row that appeared only with `ingress` would under-report
// the teardown of a config that dropped the block after applying it. Whatever
// is declared, the network is never retained.
it.effect("infra rows follow the network block, ingress declared or not, and are never retained", () =>
  Effect.gen(function*() {
    yield* Effect.forEach(
      fc.sample(fc.record({ network: fc.boolean(), ingress: fc.boolean() }), 8),
      (flags) =>
        Effect.gen(function*() {
          // `ingress` without `network` is rejected by the schema (`isIngressPlaceable`).
          const declared = { network: flags.network || flags.ingress, ingress: flags.ingress }
          const rows = yield* _rows(_encoded(declared))
          const named = new Map(rows.map((row) => [row.name, row._tag]))
          const expected = declared.network ? "Delete" : undefined
          assert.strictEqual(named.get("network/c1"), expected)
          assert.strictEqual(named.get("load-balancer/c1/ingress"), expected)
          assert.strictEqual(named.get("floating-ip/c1/ingress"), expected)
          assert.isFalse(rows.some((row) => row.name.includes("retained")))
        }),
      { discard: true }
    )
  }))
