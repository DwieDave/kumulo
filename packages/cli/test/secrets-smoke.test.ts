import { spawnSync } from "node:child_process"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { assert, describe, it } from "@effect/vitest"

const _mainTs = fileURLToPath(new URL("../src/main.ts", import.meta.url))
const _configFixture = fileURLToPath(new URL("../../../examples/ovh-mks.yaml", import.meta.url))

const _fixture = (sopsScript: string): { readonly dir: string; readonly secretsFile: string } => {
  const dir = mkdtempSync(join(tmpdir(), "kumulo-sops-smoke-"))
  writeFileSync(join(dir, "sops"), sopsScript, { mode: 0o755 })
  const secretsFile = join(dir, "secrets.yaml")
  writeFileSync(secretsFile, "")
  return { dir, secretsFile }
}

const _cleanEnv = (): Record<string, string | undefined> =>
  Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(OVH_|HCLOUD_|OS_|KUMULO_)/.test(key)))

const _run = (
  args: ReadonlyArray<string>,
  env: Record<string, string | undefined>
): string => {
  const result = spawnSync(
    process.execPath,
    ["--experimental-strip-types", "--no-warnings", _mainTs, ...args],
    { env, encoding: "utf8", timeout: 30_000 }
  )
  return `${result.stdout}${result.stderr}`
}

describe("kumulo --secrets-file subprocess smoke", () => {
  it("is a parser-known flag, listed in --help", () => {
    const output = _run(["apply", "--help"], _cleanEnv())
    assert.notInclude(output, "Unrecognized flag")
    assert.include(output, "--secrets-file")
  })

  it("feeds credential layer builds from the sops provider (broken file surfaces the sops error)", () => {
    const { dir, secretsFile } = _fixture("#!/bin/sh\necho 'Error: no key could decrypt' >&2\nexit 1\n")
    const env = _cleanEnv()
    const output = _run(
      ["apply", "--secrets-file", secretsFile, _configFixture],
      { ...env, PATH: `${dir}:${env.PATH ?? ""}` }
    )
    assert.include(output, "no key could decrypt")
    assert.notInclude(output, "missing required env var")
  })
})
