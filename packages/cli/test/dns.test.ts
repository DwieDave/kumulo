import { describe, expect, it } from "@effect/vitest"
import { Effect, Schema } from "effect"

import { ownershipTarget, recordKind } from "@kumulo/core"
import { desiredRecords, ManualDns, manualDnsTargets, reconcileDns, removeDns, renderManualDns } from "../src/dns.ts"
import type { DnsTarget, DnsTargets, ManualDnsTarget } from "../src/dns.ts"
import { spyDnsLayer } from "./mks/spy-dns.ts"
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


const _apiHost: DnsTargets = { api_server: { kind: "hostname", value: "abc123.upcloud.k8s.io" } }

const _none = decodeTestConfig(baseEncodedConfig)

const _noneWithZone = decodeTestConfig({ ...baseEncodedConfig, dns: { module: "none", zone: "example.com" } })

describe("manualDnsTargets", () => {
  it("lists each resolved target with a suggested name and the record type its value needs", () => {
    expect(manualDnsTargets({
      config: _noneWithZone,
      targets: {
        api_server: { kind: "ip", value: "10.0.0.100" },
        ingress: { kind: "ip", value: "2001:db8::1" },
        cdn: { kind: "hostname", value: "stagingeu.b-cdn.net" }
      }
    })).toEqual([
      { name: "api.prod-eu.example.com", target: "api_server", type: "A", value: "10.0.0.100" },
      { name: "*.prod-eu.example.com", target: "ingress", type: "AAAA", value: "2001:db8::1" },
      { name: "cdn.prod-eu.example.com", target: "cdn", type: "CNAME", value: "stagingeu.b-cdn.net" }
    ])
  })

  it("keeps the <zone> placeholder when dns.zone is not set", () => {
    expect(manualDnsTargets({ config: _none, targets: _apiHost })).toEqual([
      { name: "api.prod-eu.<zone>", target: "api_server", type: "CNAME", value: "abc123.upcloud.k8s.io" }
    ])
  })

  it("names the cdn target after each configured cdn hostname", () => {
    const config = decodeTestConfig({
      ...baseEncodedConfig,
      dns: { module: "none" },
      cdn: { module: "bunny", name: "stagingeu", origin: { url: "https://origin.example.com" }, hostnames: ["www.example.com", "static.example.com"] }
    })

    expect(manualDnsTargets({ config, targets: { ..._apiHost, cdn: { kind: "hostname", value: "x.b-cdn.net" } } }).filter((t) => t.target === "cdn"))
      .toEqual([
        { name: "www.example.com", target: "cdn", type: "CNAME", value: "x.b-cdn.net" },
        { name: "static.example.com", target: "cdn", type: "CNAME", value: "x.b-cdn.net" }
      ])
  })
})

describe("renderManualDns", () => {
  it("prints the instructions and an aligned target, name, type and value table", () => {
    expect(renderManualDns([
      { name: "api.prod-eu.example.com", target: "api_server", type: "CNAME", value: "abc123.upcloud.k8s.io" },
      { name: "*.prod-eu.example.com", target: "ingress", type: "A", value: "203.0.113.1" }
    ])).toBe([
      "dns.module is none: kumulo wrote no DNS records. Create these at your DNS host.",
      "The names are suggestions: any name works with the type and value shown.",
      "",
      "  TARGET      NAME                     TYPE   VALUE",
      "  api_server  api.prod-eu.example.com  CNAME  abc123.upcloud.k8s.io",
      "  ingress     *.prod-eu.example.com    A      203.0.113.1"
    ].join("\n"))
  })

  it("says how to fill in <zone> when a name still holds it", () => {
    expect(renderManualDns([{ name: "api.prod-eu.<zone>", target: "api_server", type: "A", value: "10.0.0.1" }]).split("\n")[2])
      .toBe("Replace <zone> with your domain, or set dns.zone to fill it in.")
  })

  it("prints a target reported twice once", () => {
    const target = { name: "api.prod-eu.<zone>", target: "api_server", type: "A", value: "10.0.0.1" } as const

    expect(renderManualDns([target, target]).split("\n").filter((line) => line.includes("10.0.0.1"))).toHaveLength(1)
  })

  it("prints nothing without targets", () => {
    expect(renderManualDns([])).toBe("")
  })
})

describe("reconcileDns and removeDns with dns.module none", () => {
  it.effect("hand the targets to the ManualDns sink and never call the provider", () =>
    Effect.gen(function*() {
      const spy = spyDnsLayer()
      const collected: Array<ManualDnsTarget> = []

      yield* reconcileDns({ config: _noneWithZone, targets: _apiHost }).pipe(
        Effect.provide(spy.layer),
        Effect.provideService(ManualDns, { add: (targets) => collected.push(...targets) })
      )
      yield* removeDns(_noneWithZone).pipe(Effect.provide(spy.layer))

      expect(collected).toEqual([{ name: "api.prod-eu.example.com", target: "api_server", type: "CNAME", value: "abc123.upcloud.k8s.io" }])
      expect(spy.ensured).toEqual([])
      expect(spy.removed).toEqual([])
    }))

  it.effect("send a managed module's records to the provider, not the sink", () =>
    Effect.gen(function*() {
      const spy = spyDnsLayer()
      const collected: Array<ManualDnsTarget> = []

      yield* reconcileDns({ config: _configWith([{ name: "api", target: "api_server" }]), targets: _apiHost }).pipe(
        Effect.provide(spy.layer),
        Effect.provideService(ManualDns, { add: (targets) => collected.push(...targets) })
      )

      expect(collected).toEqual([])
      expect(spy.ensured).toHaveLength(1)
    }))
})
