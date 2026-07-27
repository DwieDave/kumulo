import { describe, it } from "@effect/vitest"
import { FastCheck as fc } from "effect/testing"
import { ownershipTarget, recordKind } from "@kumulo/core"

const _octet = fc.integer({ min: 0, max: 255 })
const _ipv4 = fc.tuple(_octet, _octet, _octet, _octet).map((parts) => parts.join("."))
const _ipv6 = fc.array(fc.integer({ min: 0, max: 0xffff }), { minLength: 8, maxLength: 8 })
  .map((groups) => groups.map((g) => g.toString(16)).join(":"))
const _label = fc.stringMatching(/^[a-z][a-z0-9-]{0,20}$/)
const _hostname = fc.array(_label, { minLength: 2, maxLength: 4 }).map((labels) => labels.join("."))

describe("recordKind", () => {
  it.prop("IPv4 literal → A", [_ipv4], ([target]) => recordKind(target) === "A")

  it.prop("IPv6 literal → AAAA", [_ipv6], ([target]) => recordKind(target) === "AAAA")

  it.prop("hostname → CNAME", [_hostname], ([target]) => recordKind(target) === "CNAME")

  it.prop("ownership target → TXT", [fc.string()], ([tag]) => recordKind(ownershipTarget(tag)) === "TXT")
})
