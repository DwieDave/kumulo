import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { checkNoop } from "../src/regenCheck.ts"

/**
 * FR-4.4/AC-5 — the OVH-generated clients (mks, dns) have their own
 * `ovh2openapi`-shaped generation pipeline, separate from
 * `services.json`'s OpenStack (httpapi-format) entries, but must still be
 * caught by a "regen is a no-op" gate: a hand-edit to either committed
 * `generated/client.ts` must fail loudly, same guarantee `codegen:check`
 * already gives the six OpenStack services.
 */
describe("OVH-pipeline regen-noop coverage", () => {
  const cases = [
    { name: "distro-ovh-mks", pkgDir: "../../../packages/distro-ovh-mks" },
    { name: "dns-ovh", pkgDir: "../../../packages/dns-ovh" }
  ]

  for (const { name, pkgDir } of cases) {
    it.effect(`${name}: regenerating scripts/generate.ts reproduces the committed client byte-for-byte`, () =>
      Effect.gen(function* () {
        const { generate }: { readonly generate: () => Effect.Effect<{ readonly source: string }, unknown> } =
          yield* Effect.promise(() => import(join(import.meta.dirname, pkgDir, "scripts/generate.ts")))
        const { source } = yield* generate()
        const committed = readFileSync(join(import.meta.dirname, pkgDir, "src/generated/client.ts"), "utf8")
        yield* checkNoop({ committedPath: `${pkgDir}/src/generated/client.ts`, committed, regenerated: source })
      }))
  }

  it("check.ts registers both OVH pipelines, not just the six OpenStack services", () => {
    const checkSource = readFileSync(join(import.meta.dirname, "../src/bin/check.ts"), "utf8")
    expect(checkSource).toMatch(/distro-ovh-mks/)
    expect(checkSource).toMatch(/dns-ovh/)
  })
})
