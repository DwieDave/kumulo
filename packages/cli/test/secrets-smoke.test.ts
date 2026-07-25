/**
 * Subprocess smoke test (N4): runs the real `main.ts` under bun with a fake
 * `sops` on PATH, proving credentials sourced from a secrets file reach the
 * credential layers, and that `--secrets-file` is stripped before the CLI
 * parser sees it (it is not a declared `Command` flag).
 */
import { spawnSync } from "node:child_process"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { assert, describe, it } from "@effect/vitest"

const _mainTs = fileURLToPath(new URL("../src/main.ts", import.meta.url))

const _fixture = (): { readonly dir: string; readonly secretsFile: string } => {
  const dir = mkdtempSync(join(tmpdir(), "kumulo-sops-smoke-"))
  const stdout = `{"OVH_SERVICE_NAME":"svc","OVH_CLIENT_ID":"id","OVH_CLIENT_SECRET":"sec"}`
  writeFileSync(join(dir, "sops"), `#!/bin/sh\necho '${stdout}'\n`, { mode: 0o755 })
  const secretsFile = join(dir, "secrets.yaml")
  writeFileSync(secretsFile, "")
  return { dir, secretsFile }
}

// Inherited credentials would mask what the secrets file provides.
const _cleanEnv = (): Record<string, string | undefined> =>
  Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(OVH_|HCLOUD_|OS_|KUMULO_)/.test(key)))

describe("kumulo --secrets-file subprocess smoke (N4)", () => {
  it("serves credentials from the secrets file and strips the flag before parsing", () => {
    const { dir, secretsFile } = _fixture()
    const env = _cleanEnv()
    const result = spawnSync("bun", [_mainTs, "apply", "--secrets-file", secretsFile], {
      env: { ...env, PATH: `${dir}:${env.PATH ?? ""}` },
      encoding: "utf8",
      timeout: 30_000
    })
    const output = `${result.stdout}${result.stderr}`
    // Layer build succeeded off the sops values (no missing-env failure), and the
    // parser never saw the flag — the only complaint is the absent config argument.
    assert.notInclude(output, "Unrecognized flag")
    assert.notInclude(output, "missing required env var")
    assert.include(output, "Missing required argument: config")
  })
})
