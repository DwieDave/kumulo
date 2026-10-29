import { spawnSync } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

const oxlintBin = fileURLToPath(new URL("../../../../../node_modules/.bin/oxlint", import.meta.url))
const pluginPath = fileURLToPath(new URL("../../../src/anti-slop/index.ts", import.meta.url))

const probeRoot = mkdtempSync(join(tmpdir(), "anti-slop-spacing-"))
const config = join(probeRoot, "oxlint.json")
const first = join(probeRoot, "first.ts")
const second = join(probeRoot, "second.ts")

const _runSpacingLint = (...args: Array<string>) => {
  const result = spawnSync(oxlintBin, ["--config", config, ...args], { encoding: "utf8" })

  return { status: result.status, output: `${result.stdout}\n${result.stderr}` }
}

const _readBoth = () => [readFileSync(first, "utf8"), readFileSync(second, "utf8")]

describe("require-readable-spacing CLI", () => {
  beforeAll(() => {
    writeFileSync(
      config,
      JSON.stringify({
        jsPlugins: [{ name: "anti-slop", specifier: pluginPath }],
        rules: { "anti-slop/require-readable-spacing": "error" }
      })
    )
    writeFileSync(first, "export const a = 1;\n/** Attached to b. */\nexport const b = 2;\n")
    writeFileSync(second, "export function f() {\nconst a = 1;\nconst b = 2;\nreturn a + b;\n}\n")
  })

  afterAll(() => {
    rmSync(probeRoot, { recursive: true, force: true })
  })

  it("rejects, fixes, and stays stable", () => {
    const rejected = _runSpacingLint(first, second)

    expect(rejected.status, rejected.output).toBe(1)
    expect(rejected.output).toMatch(/require-readable-spacing/)

    const fixed = _runSpacingLint("--fix", first, second)

    expect(fixed.status, fixed.output).toBe(0)
    expect(_readBoth()).toEqual([
      "export const a = 1;\n\n/** Attached to b. */\nexport const b = 2;\n",
      "export function f() {\nconst a = 1;\nconst b = 2;\n\nreturn a + b;\n}\n"
    ])

    const stable = _readBoth()
    const clean = _runSpacingLint(first, second)

    expect(clean.status, clean.output).toBe(0)

    const repeated = _runSpacingLint("--fix", first, second)

    expect(repeated.status, repeated.output).toBe(0)
    expect(_readBoth()).toEqual(stable)
  })
})
