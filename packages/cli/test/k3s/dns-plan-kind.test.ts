import { assert, it } from "@effect/vitest"
import { dnsPlanActions } from "../../src/dns-plan.ts"

const _kinds = (targets: ReadonlyArray<string>) =>
  dnsPlanActions({
    config: { module: "ovh", zone: "example.com", records: targets.map((target, i) => ({ name: `r${i}`, target })) },
    targetKind: "ip"
  }).map((action) => action.name.slice(action.name.indexOf("(")))

it("classifies IPv4 as A, IPv6 as AAAA, hostname as CNAME", () => {
  assert.deepStrictEqual(_kinds(["203.0.113.10", "2001:db8::1", "lb.example.net"]), ["(A)", "(AAAA)", "(CNAME)"])
})
