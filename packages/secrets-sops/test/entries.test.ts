import { describe, expect, it } from "@effect/vitest"
import { Redacted } from "effect"
import * as fc from "effect/testing/FastCheck"
import type { CredentialEntry } from "@kumulo/core"
import { buildCredentialsPayload } from "../src/entries.ts"

const _entry = (key: string, value: string): CredentialEntry => ({ key, value: Redacted.make(value) })

describe("buildCredentialsPayload", () => {
  it("nests dot-path keys, unwrapping Redacted values", () => {
    expect(buildCredentialsPayload([_entry("cluster", "staging"), _entry("s3.user", "kumulo-staging")])).toEqual({
      cluster: "staging",
      s3: { user: "kumulo-staging" }
    })
  })

  it("builds an array from numeric dot-path segments (R10 buckets[])", () => {
    const entries = [
      _entry("cluster", "staging"),
      _entry("s3.user", "kumulo-staging"),
      _entry("s3.accessKey", "AKIA"),
      _entry("s3.secretKey", "secret"),
      _entry("s3.buckets.0.name", "staging-eu-backups"),
      _entry("s3.buckets.0.region", "DE1"),
      _entry("s3.buckets.0.endpoint", "https://s3.de1.io.cloud.ovh.net"),
      _entry("s3.buckets.1.name", "staging-eu-logs"),
      _entry("s3.buckets.1.region", "DE1"),
      _entry("s3.buckets.1.endpoint", "https://s3.de1.io.cloud.ovh.net")
    ]
    expect(buildCredentialsPayload(entries)).toEqual({
      cluster: "staging",
      s3: {
        user: "kumulo-staging",
        accessKey: "AKIA",
        secretKey: "secret",
        buckets: [
          { name: "staging-eu-backups", region: "DE1", endpoint: "https://s3.de1.io.cloud.ovh.net" },
          { name: "staging-eu-logs", region: "DE1", endpoint: "https://s3.de1.io.cloud.ovh.net" }
        ]
      }
    })
  })

  it("empty entries build an empty payload", () => {
    expect(buildCredentialsPayload([])).toEqual({})
  })

  it.prop(
    "every flat (non-dotted) key round-trips to its own top-level value",
    {
      pairs: fc.uniqueArray(
        fc.tuple(
          fc.string({ minLength: 1, maxLength: 10 }).filter((s) => /^[a-zA-Z]+$/.test(s)),
          fc.string({ minLength: 1, maxLength: 10 })
        ),
        { selector: ([key]) => key }
      )
    },
    ({ pairs }) => {
      const payload = buildCredentialsPayload(pairs.map(([key, value]) => _entry(key, value)))
      for (const [key, value] of pairs) {
        expect(payload[key]).toBe(value)
      }
    }
  )
})
