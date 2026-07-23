import { describe, expect, it } from "@effect/vitest"
import { renderCloudInit } from "../../src/cloudinit/render.ts"

describe("renderCloudInit", () => {
  it("includes hostname, ssh key, and hardening — no k3s install", () => {
    const yaml = renderCloudInit({ hostname: "master-1", sshPublicKey: "ssh-ed25519 AAAA... test" })
    expect(yaml).toContain("hostname: master-1")
    expect(yaml).toContain("ssh-ed25519 AAAA... test")
    expect(yaml).toContain("PasswordAuthentication no")
    expect(yaml).toContain("PermitRootLogin prohibit-password")
    expect(yaml).not.toContain("get.k3s.io")
  })

  it("renders custom packages instead of the default set", () => {
    const yaml = renderCloudInit({ hostname: "worker-1", sshPublicKey: "key", packages: ["curl", "jq"] })
    expect(yaml).toContain("- curl")
    expect(yaml).toContain("- jq")
    expect(yaml).not.toContain("open-iscsi")
  })
})
