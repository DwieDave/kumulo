import { describe, it } from "@effect/vitest"
import { Arbitrary, Schema } from "effect"
import { ownershipTarget, recordKind } from "@kumulo/core"

const _octet = Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 255 }))
const _ipv4 = Arbitrary.map(Arbitrary.schema(Schema.Tuple([_octet, _octet, _octet, _octet])), (parts) => parts.join("."))

const _group = Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 0xffff }))

const _ipv6 = Arbitrary.map(
  Arbitrary.array(Arbitrary.schema(_group), { minLength: 8, maxLength: 8 }),
  (groups) => groups.map((g) => g.toString(16)).join(":")
)

const _label = Schema.String.check(Schema.isPattern(/^[a-z][a-z0-9-]{0,20}$/))

const _hostname = Arbitrary.map(
  Arbitrary.array(Arbitrary.schema(_label), { minLength: 2, maxLength: 4 }),
  (labels) => labels.join(".")
)

describe("recordKind", () => {
  it.prop("IPv4 literal → A", [_ipv4], ([target]) => recordKind(target) === "A")

  it.prop("IPv6 literal → AAAA", [_ipv6], ([target]) => recordKind(target) === "AAAA")

  it.prop("hostname → CNAME", [_hostname], ([target]) => recordKind(target) === "CNAME")

  it.prop("ownership target → TXT", [Schema.String], ([tag]) => recordKind(ownershipTarget(tag)) === "TXT")
})
