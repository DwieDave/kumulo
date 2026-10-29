import { describe, expect, it } from "@effect/vitest"
import { Schema } from "effect"
import { recordKind } from "@kumulo/dns-hetzner"
import { ownershipTarget } from "@kumulo/core"
import { desiredRecords } from "../src/dns.ts"
import type { DnsTarget, DnsTargets } from "../src/dns.ts"
import type { ClusterConfig } from "../src/cluster-config.ts"
import { baseEncodedConfig, decodeTestConfig } from "./fixtures.ts"

const _configWith = (records: ReadonlyArray<{ name: string; target: string }>): ClusterConfig =>
  decodeTestConfig({ ...baseEncodedConfig, dns: { module: "hetzner", zone: "example.com", ttl: 300, records } })

const _Octet = (minimum: number) => Schema.Int.check(Schema.isBetween({ minimum, maximum: 254 }))

const _DnsTargetSchema = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("ip"), a: _Octet(1), b: _Octet(0) }),
  Schema.Struct({ kind: Schema.Literal("hostname"), value: Schema.Literals(["api.mks.ovh.net", "abc.eu-west-1.mks.example", "lb-1.foo.bar"]) })
])

const _toDnsTarget = (generated: typeof _DnsTargetSchema.Type): DnsTarget =>
  generated.kind === "ip" ? { kind: "ip", value: `10.0.${generated.b}.${generated.a}` } : { kind: "hostname", value: generated.value }

const _API = "api.example.net"
const _FIP = "203.0.113.1"

const _bothRecords = _configWith([{ name: "api", target: "api_server" }, { name: "www", target: "ingress" }])

const _OWNER = ownershipTarget("prod-eu")

describe("desiredRecords", () => {
  it("substitutes api_server and passes an unresolved ingress through literally", () => {
    expect(desiredRecords({ config: _bothRecords, targets: { api_server: { kind: "ip", value: "10.0.0.100" } } })).toEqual([
      { name: "api", target: "10.0.0.100" },
      { name: "www", target: "ingress" },
      { name: "api", target: _OWNER },
      { name: "www", target: _OWNER }
    ])
  })

  it("resolves ingress from its own target when one is supplied", () => {
    expect(desiredRecords({
      config: _bothRecords,
      targets: { api_server: { kind: "hostname", value: "abc.mks.ovh.net" }, ingress: { kind: "ip", value: "203.0.113.1" } }
    })).toEqual([
      { name: "api", target: "abc.mks.ovh.net" },
      { name: "www", target: "203.0.113.1" },
      { name: "api", target: _OWNER },
      { name: "www", target: _OWNER }
    ])
  })

  it.prop("emits exactly one ownership TXT record per distinct name", [
    Schema.Array(Schema.Struct({
      name: Schema.Literals(["api", "www", "lb"]),
      target: Schema.Literals(["api_server", "ingress", "10.0.0.5"])
    })).check(Schema.isBetweenLength(1, 6))
  ], ([records]) => {
    const out = desiredRecords({
      config: _configWith(records),
      targets: { api_server: { kind: "hostname", value: _API }, ingress: { kind: "ip", value: _FIP } }
    })

    const owners = out.filter((r) => r.target === _OWNER)
    expect(owners.map((r) => r.name).toSorted()).toEqual([...new Set(records.map((r) => r.name))].toSorted())
    expect(out).toHaveLength(records.length + owners.length)
  })

  it("writes a mistyped placeholder literally rather than failing", () => {
    const config = _configWith([{ name: "api", target: "api-server" }, { name: "www", target: "Ingress" }])
    expect(desiredRecords({
      config,
      targets: { api_server: { kind: "ip", value: "10.0.0.100" }, ingress: { kind: "ip", value: "203.0.113.1" } }
    })).toEqual([
      { name: "api", target: "api-server" },
      { name: "www", target: "Ingress" },
      { name: "api", target: _OWNER },
      { name: "www", target: _OWNER }
    ])
  })

  it.prop("a record takes its placeholder's value, or stays exactly as written", [
    Schema.Literals(["api_server", "ingress", "api-server", "ingres", "INGRESS", "www.example.com", "203.0.113.7"]),
    Schema.Boolean
  ], ([target, withIngress]) => {
    const apiServer: DnsTarget = { kind: "hostname", value: _API }
    const targets: DnsTargets = withIngress ? { api_server: apiServer, ingress: { kind: "ip", value: _FIP } } : { api_server: apiServer }

    const [record] = desiredRecords({ config: _configWith([{ name: "r", target }]), targets })
    expect(record?.target).toBe(
      target === "api_server" ? _API : target === "ingress" && withIngress ? _FIP : target
    )
  })

  it.prop("ip targets yield an A record, hostname targets a CNAME", [_DnsTargetSchema], ([generated]) => {
    const target = _toDnsTarget(generated)

    const [record] = desiredRecords({
      config: _configWith([{ name: "api", target: "api_server" }]),
      targets: { api_server: target }
    })

    expect(record?.target).toBe(target.value)
    expect(recordKind(record?.target ?? "")).toBe(target.kind === "ip" ? "A" : "CNAME")
  })
})
