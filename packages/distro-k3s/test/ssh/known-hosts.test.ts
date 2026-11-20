import { describe, expect, it } from "vitest"
import { mkdtempSync, readFileSync, statSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describeSshError, redactCommand, SshCommandError, SshHostKeyMismatch } from "../../src/ssh/errors.ts"
import { checkHostKey } from "../../src/ssh/known-hosts.ts"

const host = { ip: "10.0.0.1", port: 22 }
const _path = () => join(mkdtempSync(join(tmpdir(), "kh-")), "sub", "c.known_hosts")

describe("checkHostKey", () => {
  it("records on first use, trusts the same key, rejects a changed key", () => {
    const path = _path()
    expect(checkHostKey({ path, host, key: Buffer.from("a") })).toBe("recorded")
    expect(checkHostKey({ path, host, key: Buffer.from("a") })).toBe("trusted")
    expect(checkHostKey({ path, host, key: Buffer.from("b") })).toBe("mismatch")
    expect(readFileSync(path, "utf8").trim().split("\n")).toHaveLength(1)
    expect(statSync(path).mode & 0o777).toBe(0o600)
  })

  it("tracks hosts independently", () => {
    const path = _path()
    checkHostKey({ path, host, key: Buffer.from("a") })
    expect(checkHostKey({ path, host: { ip: "10.0.0.2", port: 22 }, key: Buffer.from("b") })).toBe("recorded")
  })
})

describe("errors", () => {
  it("mismatch message explains reset", () => {
    expect(new SshHostKeyMismatch({ host: "h", knownHostsPath: "/x/k" }).message).toContain("remove its line from /x/k")
  })

  it("redacts the token", () => {
    expect(redactCommand("A=1 K3S_TOKEN='se'\\''cret' B=2")).toBe("A=1 K3S_TOKEN='***' B=2")
    expect(redactCommand("K3S_TOKEN=abc \\")).not.toContain("abc")
  })

  it("truncates stderr keeping the tail", () => {
    const error = new SshCommandError({ host: "h", command: "c", cause: `exit 1: ${"x".repeat(5000)}END` })
    const text = describeSshError(error)
    expect(text.length).toBeLessThan(2100)
    expect(text.endsWith("END")).toBe(true)
  })
})
