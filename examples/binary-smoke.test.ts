import { execFileSync } from "node:child_process"
import { existsSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

// NFR-7 — the compiled `kumulo` binary (via `bun run build:binary`) actually
// runs: `--help` and a `create --dry-run` against an example config. Only
// runs when `dist/kumulo` already exists (built by `scripts/build-binary.sh`)
// so a plain `bun run test` doesn't pay the ~60s compile cost every time.
const _root = join(import.meta.dirname, "..")
const _binary = join(_root, "dist", "kumulo")

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

describe.skipIf(!existsSync(_binary))("compiled kumulo binary", () => {
  it("--help prints usage", () => {
    const out = execFileSync(_binary, ["--help"], { env: _fakeEnv, encoding: "utf8" })
    expect(out).toContain("kumulo <subcommand>")
  })

  // The ovh-mks plan is a live diff (cluster/pool/volume/bucket existence is
  // looked up against OVH), so dry-run with fake credentials must fail loudly
  // instead of printing a made-up plan.
  it("create --dry-run against the ovh-mks example fails loudly on fake credentials", () => {
    expect(() =>
      execFileSync(
        _binary,
        ["create", "--config", join(_root, "examples", "ovh-mks.yaml"), "--dry-run"],
        { env: _fakeEnv, encoding: "utf8", stdio: "pipe" }
      )
    ).toThrow(/OAuth2 token request failed|Authentication failed/)
  })

  it("create --dry-run prints a plan against the k3s example", () => {
    const out = execFileSync(
      _binary,
      ["create", "--config", join(_root, "examples", "k3s.yaml"), "--dry-run"],
      { env: _fakeEnv, encoding: "utf8" }
    )
    expect(out).toContain("to create")
  })

  // k3s plans are config-only (buildK3sPlan, R13) — provider: hetzner prints
  // the same shape without ever touching HCLOUD_TOKEN/the hcloud API.
  it("create --dry-run prints a plan against the k3s-hetzner example", () => {
    const out = execFileSync(
      _binary,
      ["create", "--config", join(_root, "examples", "k3s-hetzner.yaml"), "--dry-run"],
      { env: _fakeEnv, encoding: "utf8" }
    )
    expect(out).toContain("to create")
  })
})
