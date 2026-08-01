import { execFileSync } from "node:child_process"
import { existsSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

const _root = join(import.meta.dirname, "..")
const _cli = join(_root, "packages", "cli", "dist", "main.mjs")

if (!existsSync(_cli)) {
  throw new Error(`${_cli} not found — run \`bun run build\` before this smoke test.`)
}

const _fakeEnv = {
  ...process.env,
  OVH_CLIENT_ID: "x",
  OVH_CLIENT_SECRET: "x",
  OVH_SERVICE_NAME: "x",
  OS_AUTH_URL: "http://example.invalid",
  OS_USERNAME: "x",
  OS_PASSWORD: "x",
  OS_PROJECT_NAME: "x",
  OS_REGION_NAME: "x",
  HCLOUD_TOKEN: "x",
  HETZNER_DNS_TOKEN: "x"
}

const _dryRun = (example: string): string =>
  execFileSync(process.execPath, [_cli, "apply", join(_root, "examples", example), "--dry-run"], {
    env: _fakeEnv,
    encoding: "utf8",
    stdio: "pipe"
  })

describe("published kumulo CLI bundle", () => {
  it("--help lists the subcommands", () => {
    const out = execFileSync(process.execPath, [_cli, "--help"], { env: _fakeEnv, encoding: "utf8" })
    expect(out).toContain("kumulo")
    expect(out).toContain("apply")
    expect(out).toContain("kubeconfig")
  })

  it("apply --dry-run against the ovh-mks example fails loudly on fake credentials", () => {
    expect(() =>
      execFileSync(process.execPath, [_cli, "apply", join(_root, "examples", "ovh-mks.yaml"), "--dry-run"], {
        env: _fakeEnv,
        encoding: "utf8",
        stdio: "pipe"
      })
    ).toThrow(/OAuth2 token request failed|Authentication failed/)
  })

  it("apply --dry-run against the k3s example fails loudly on fake credentials", () => {
    expect(() => _dryRun("k3s.yaml")).toThrow(/POST http:\/\/example\.invalid\/v3\/auth\/tokens/)
  })

  it("apply --dry-run against the k3s-hetzner example fails loudly on fake credentials", () => {
    expect(() => _dryRun("k3s-hetzner.yaml")).toThrow(/Authentication failed: \w[\w -]*prod-fsn: hcloud rejected the API token/)
  })
})
