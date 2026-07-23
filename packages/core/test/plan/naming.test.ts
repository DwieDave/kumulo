import { describe, expect, it } from "@effect/vitest"
import { resourceName } from "../../src/plan/naming.ts"

describe("resourceName", () => {
  it("follows kumulo-<cluster>-<role>-<pool>-<index>", () => {
    expect(resourceName({ cluster: "prod", role: "worker", pool: "default", index: 2 })).toBe(
      "kumulo-prod-worker-default-2"
    )
  })
})
