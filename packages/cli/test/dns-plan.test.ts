import { assert, it } from "@effect/vitest"
import { dnsPlanActions } from "../src/dns-plan.ts"
import { buildK3sPlan } from "../src/k3s/plan.ts"
import { buildMksPlan, emptyMksInventory } from "../src/mks/plan.ts"
import { baseEncodedConfig, decodeTestConfig } from "./fixtures.ts"

const _dns = {
  module: "hetzner",
  zone: "example.com",
  records: [{ name: "api", target: "api_server" }, { name: "www", target: "ingress.example.com" }]
} as const

const _k3sConfig = decodeTestConfig({ ...baseEncodedConfig, dns: { ..._dns, ttl: 300 } })

it("plans an A record for the k3s api server and a CNAME for a hostname target", () => {
  assert.deepStrictEqual(dnsPlanActions({ config: _dns, targetKind: "ip" }), [
    { _tag: "Create", name: "dns/example.com/api (A)" },
    { _tag: "Create", name: "dns/example.com/www (CNAME)" }
  ])
})

it("plans a CNAME for the mks api server (hostname target)", () => {
  assert.deepStrictEqual(dnsPlanActions({ config: _dns, targetKind: "hostname" }), [
    { _tag: "Create", name: "dns/example.com/api (CNAME)" },
    { _tag: "Create", name: "dns/example.com/www (CNAME)" }
  ])
})

it("emits nothing when dns.module is none", () => {
  assert.deepStrictEqual(dnsPlanActions({ config: { ..._dns, module: "none" }, targetKind: "ip" }), [])
})

it("k3s plan output includes DNS rows", () => {
  const names = buildK3sPlan(_k3sConfig).actions.map((a) => a.name)
  assert.ok(names.includes("dns/example.com/api (A)"))
  assert.ok(names.includes("dns/example.com/www (CNAME)"))
})

it("mks plan output includes DNS rows", () => {
  const plan = buildMksPlan({
    config: {
      name: "prod-eu",
      worker_pools: [{ name: "workers" }],
      volumes: { module: "none", managed: [] },
      dns: _dns
    },
    inventory: emptyMksInventory
  })
  assert.deepStrictEqual(plan.actions.map((a) => a.name), [
    "mks-cluster/prod-eu",
    "mks-pool/prod-eu/workers",
    "dns/example.com/api (CNAME)",
    "dns/example.com/www (CNAME)"
  ])
})
