import { describe, expect, it } from "@effect/vitest"
import { FastCheck as fc } from "effect/testing"
import { recordKind } from "@kumulo/dns-hetzner"
import { desiredRecords } from "../src/dns.ts"
import type { DnsTarget } from "../src/dns.ts"
import type { ClusterConfig } from "@kumulo/core"
import { baseEncodedConfig, decodeTestConfig } from "./fixtures.ts"

const _configWith = (records: ReadonlyArray<{ name: string; target: string }>): ClusterConfig =>
  decodeTestConfig({ ...baseEncodedConfig, dns: { module: "hetzner", zone: "example.com", ttl: 300, records } })

const _ipArb = fc.tuple(fc.integer({ min: 1, max: 254 }), fc.integer({ min: 0, max: 254 })).map(([a, b]) => `10.0.${b}.${a}`)
const _hostArb = fc.constantFrom("api.mks.ovh.net", "abc.eu-west-1.mks.example", "lb-1.foo.bar")

describe("desiredRecords", () => {
  it("substitutes only the api_server target", () => {
    const config = _configWith([{ name: "api", target: "api_server" }, { name: "www", target: "ingress" }])
    expect(desiredRecords({ config, apiTarget: { kind: "ip", value: "10.0.0.100" } })).toEqual([
      { name: "api", target: "10.0.0.100" },
      { name: "www", target: "ingress" }
    ])
  })

  it.prop("ip targets yield an A record, hostname targets a CNAME", [fc.oneof(
    _ipArb.map((value): DnsTarget => ({ kind: "ip", value })),
    _hostArb.map((value): DnsTarget => ({ kind: "hostname", value }))
  )], ([target]) => {
    const [record] = desiredRecords({ config: _configWith([{ name: "api", target: "api_server" }]), apiTarget: target })
    expect(record?.target).toBe(target.value)
    expect(recordKind(record?.target ?? "")).toBe(target.kind === "ip" ? "A" : "CNAME")
  })
})
