import { assert, it } from "@effect/vitest"
import { dnsPlanActions } from "../src/dns-plan.ts"
import { buildK3sPlan } from "../src/k3s/plan.ts"
import { buildMksPlan, emptyMksInventory } from "../src/mks/plan.ts"
import { baseEncodedConfig, decodeK3sTestConfig } from "./fixtures.ts"

const _dns = {
  module: "hetzner",
  zone: "example.com",
  records: [{ name: "api", target: "api_server" }, { name: "www", target: "ingress.example.com" }]
} as const

const _k3sConfig = decodeK3sTestConfig({ ...baseEncodedConfig, dns: { ..._dns, ttl: 300 } })

const _ingressDns = {
  module: "hetzner",
  zone: "example.com",
  records: [{ name: "www", target: "ingress" }]
} as const

it("plans an A record for the k3s api server and a CNAME for a hostname target", () => {
  assert.deepStrictEqual(dnsPlanActions({ config: _dns, targets: { api_server: "ip" } }), [
    { _tag: "Create", name: "dns/example.com/api (A)" },
    { _tag: "Create", name: "dns/example.com/www (CNAME)" }
  ])
})

it("plans a CNAME for the mks api server (hostname target)", () => {
  assert.deepStrictEqual(dnsPlanActions({ config: _dns, targets: { api_server: "hostname" } }), [
    { _tag: "Create", name: "dns/example.com/api (CNAME)" },
    { _tag: "Create", name: "dns/example.com/www (CNAME)" }
  ])
})

it("plans an A record for an ingress target the apply will resolve", () => {
  assert.deepStrictEqual(dnsPlanActions({ config: _ingressDns, targets: { api_server: "hostname", ingress: "ip" } }), [
    { _tag: "Create", name: "dns/example.com/www (A)" }
  ])
})

it("plans an unresolvable ingress target as the literal CNAME the apply writes", () => {
  assert.deepStrictEqual(dnsPlanActions({ config: _ingressDns, targets: { api_server: "hostname" } }), [
    { _tag: "Create", name: "dns/example.com/www (CNAME)" }
  ])
})

it("emits nothing when dns.module is none", () => {
  assert.deepStrictEqual(dnsPlanActions({ config: { ..._dns, module: "none" }, targets: { api_server: "ip" } }), [])
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
      worker_pools: [{ name: "workers", flavor: "b2-7", count: 1 }],
      volumes: { module: "none" },
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

it("mks plan renders an ingress record as an A record exactly when the config declares an ingress LB", () => {
  const _plan = (ingress?: { readonly flavor_id?: string }) =>
    buildMksPlan({
      config: {
        name: "prod-eu",
        worker_pools: [],
        volumes: { module: "none" },
        dns: _ingressDns,
        ...(ingress === undefined ? {} : { network: { cidr: "10.0.0.0/16" }, ingress })
      },
      inventory: emptyMksInventory
    }).actions.map((a) => a.name)

  assert.include(_plan({}), "dns/example.com/www (A)")
  assert.include(_plan(), "dns/example.com/www (CNAME)")
})
