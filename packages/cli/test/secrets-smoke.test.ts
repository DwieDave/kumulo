/**
 * Subprocess smoke test (N4): runs the real `main.ts` under node (type
 * stripping) with a fake
 * `sops` on PATH, proving `--secrets-file` is a real parser-known shared flag
 * (visible in `--help`) and that the sops `ConfigProvider` installed via
 * `Command.provide` actually feeds the credential layer builds. The success
 * path (values served from the file) is covered in-process by
 * `secrets-file.test.ts` — here the broken-file path is used instead, since it
 * fails during layer build, before any network call.
 */
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

// Inherited credentials would mask what the secrets file provides.
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

describe("kumulo --secrets-file subprocess smoke (N4)", () => {
  it("is a parser-known flag, listed in --help", () => {
    const output = _run(["apply", "--help"], _cleanEnv())
    assert.notInclude(output, "Unrecognized flag")
    assert.include(output, "--secrets-file")
  })

  it("feeds credential layer builds from the sops provider (broken file surfaces the sops error, R6)", () => {
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
