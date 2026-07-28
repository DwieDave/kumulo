import { describe, expect, it } from "@effect/vitest"
import { FastCheck as fc } from "effect/testing"
import { recordKind } from "@kumulo/dns-hetzner"
import { ownershipTarget } from "@kumulo/core"
import { desiredRecords } from "../src/dns.ts"
import type { DnsTarget } from "../src/dns.ts"
import type { ClusterConfig } from "@kumulo/core"
import { baseEncodedConfig, decodeTestConfig } from "./fixtures.ts"

const _configWith = (records: ReadonlyArray<{ name: string; target: string }>): ClusterConfig =>
  decodeTestConfig({ ...baseEncodedConfig, dns: { module: "hetzner", zone: "example.com", ttl: 300, records } })

const _ipArb = fc.tuple(fc.integer({ min: 1, max: 254 }), fc.integer({ min: 0, max: 254 })).map(([a, b]) => `10.0.${b}.${a}`)
const _hostArb = fc.constantFrom("api.mks.ovh.net", "abc.eu-west-1.mks.example", "lb-1.foo.bar")

const _API = "api.example.net"
const _FIP = "203.0.113.1"

const _bothRecords = _configWith([{ name: "api", target: "api_server" }, { name: "www", target: "ingress" }])

const _OWNER = ownershipTarget("prod-eu")

describe("desiredRecords", () => {
  // N1/scope §5: k3s supplies an `api_server` target and nothing else, so
  // `ingress` must still reach the provider as the literal string it is today.
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

  // The `DnsProvider` contract keys ownership off a `kumulo.cluster=<tag>` TXT
  // record at the same name. Without one, every record kumulo wrote looks
  // foreign on the next apply (`ResourceConflict`) and `removeClusterRecords`
  // finds nothing to delete — emitting it here is what makes a second apply
  // converge, and it is the same tag `removeDns` deletes by (`config.name`).
  it.prop("emits exactly one ownership TXT record per distinct name", [
    fc.array(fc.record({ name: fc.constantFrom("api", "www", "lb"), target: fc.constantFrom("api_server", "ingress", "10.0.0.5") }), {
      minLength: 1,
      maxLength: 6
    })
  ], ([records]) => {
    const out = desiredRecords({
      config: _configWith(records),
      targets: { api_server: { kind: "hostname", value: _API }, ingress: { kind: "ip", value: _FIP } }
    })
    const owners = out.filter((r) => r.target === _OWNER)
    expect(owners.map((r) => r.name).toSorted()).toEqual([...new Set(records.map((r) => r.name))].toSorted())
    expect(out).toHaveLength(records.length + owners.length)
  })

  // Pinned deliberately, not inherited: nothing rejects a target that resolves
  // to nothing, so `api-server` is written as a CNAME to the hostname
  // `api-server`. That silence is the cost of R15's pass-through, and it is the
  // same mechanism that leaves `ingress` literal with no LB to point at.
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

  // Totality: every target either names a supplied placeholder and becomes its
  // value, or survives untouched. No third outcome, for any input.
  it.prop("a record takes its placeholder's value, or stays exactly as written", [
    // The schema already rejects an empty target, so every case here decodes.
    fc.constantFrom("api_server", "ingress", "api-server", "ingres", "INGRESS", "www.example.com", "203.0.113.7"),
    fc.boolean()
  ], ([target, withIngress]) => {
    const targets = {
      api_server: { kind: "hostname" as const, value: _API },
      ...(withIngress ? { ingress: { kind: "ip" as const, value: _FIP } } : {})
    }
    const [record] = desiredRecords({ config: _configWith([{ name: "r", target }]), targets })
    expect(record?.target).toBe(
      target === "api_server" ? _API : target === "ingress" && withIngress ? _FIP : target
    )
  })

  it.prop("ip targets yield an A record, hostname targets a CNAME", [fc.oneof(
    _ipArb.map((value): DnsTarget => ({ kind: "ip", value })),
    _hostArb.map((value): DnsTarget => ({ kind: "hostname", value }))
  )], ([target]) => {
    const [record] = desiredRecords({
      config: _configWith([{ name: "api", target: "api_server" }]),
      targets: { api_server: target }
    })
    expect(record?.target).toBe(target.value)
    expect(recordKind(record?.target ?? "")).toBe(target.kind === "ip" ? "A" : "CNAME")
  })
})
