import { chmodSync, copyFileSync, mkdtempSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import * as BunServices from "@effect/platform-bun/BunServices"
import { afterEach, describe, expect, it } from "@effect/vitest"
import { Effect, Redacted } from "effect"
import { FileSystem } from "effect/FileSystem"
import { ChildProcessSpawner as ChildProcessSpawnerNS } from "effect/unstable/process"
import { CredentialsSink } from "@kumulo/core"
import type { CredentialEntry } from "@kumulo/core"
import { credentialsPath, sopsCredentialsSinkLive } from "../src/sink.ts"

const ChildProcessSpawner = ChildProcessSpawnerNS.ChildProcessSpawner

const _fixture = (name: string) => join(import.meta.dirname, "fixtures", name)

const originalPath = process.env.PATH

// Puts a fixture script on PATH under the literal name "sops" (per test, in
// its own temp dir) so it's found the same way a real `sops` binary would be.
const _installFakeSops = (script: string): { readonly captureDir: string } => {
  const binDir = mkdtempSync(join(tmpdir(), "kumulo-fake-sops-bin-"))
  copyFileSync(_fixture(script), join(binDir, "sops"))
  chmodSync(join(binDir, "sops"), 0o755)
  const captureDir = mkdtempSync(join(tmpdir(), "kumulo-fake-sops-capture-"))
  process.env.PATH = `${binDir}:${originalPath}`
  process.env.SOPS_CAPTURE_DIR = captureDir
  return { captureDir }
}

const _emptyPathOnly = (): void => {
  process.env.PATH = mkdtempSync(join(tmpdir(), "kumulo-no-sops-bin-"))
}

afterEach(() => {
  process.env.PATH = originalPath
  delete process.env.SOPS_CAPTURE_DIR
})

const _entry = (key: string, value: string): CredentialEntry => ({ key, value: Redacted.make(value) })

const entries: ReadonlyArray<CredentialEntry> = [
  _entry("cluster", "staging"),
  _entry("s3.user", "kumulo-staging"),
  _entry("s3.accessKey", "AKIA"),
  _entry("s3.secretKey", "supersecret"),
  _entry("s3.buckets.0.name", "staging-eu-backups"),
  _entry("s3.buckets.0.region", "DE1"),
  _entry("s3.buckets.0.endpoint", "https://s3.de1.io.cloud.ovh.net")
]

const _runWrite = (
  { dir, ageRecipient, writeEntries }: { readonly dir: string; readonly ageRecipient: string; readonly writeEntries: ReadonlyArray<CredentialEntry> }
) =>
  Effect.gen(function*() {
    const { fs, spawner } = yield* Effect.provide(Effect.all({ fs: FileSystem, spawner: ChildProcessSpawner }), BunServices.layer)
    const sink = sopsCredentialsSinkLive({ dir, ageRecipient, spawner, fs })
    const service = yield* Effect.provide(CredentialsSink, sink)
    yield* service.write(writeEntries)
  })

describe("sopsCredentialsSinkLive", () => {
  it.effect("pipes plaintext via stdin, invokes sops with the expected args, and writes ciphertext to the output file", () =>
    Effect.gen(function*() {
      const { captureDir } = _installFakeSops("fake-sops.sh")
      const dir = mkdtempSync(join(tmpdir(), "kumulo-secrets-dir-"))
      yield* _runWrite({ dir, ageRecipient: "age1testrecipient", writeEntries: entries })

      const args = readFileSync(join(captureDir, "args"), "utf8")
      expect(args).toContain("--encrypt")
      expect(args).toContain("--input-type yaml")
      expect(args).toContain("--output-type yaml")
      expect(args).toContain("--age age1testrecipient")
      expect(args).toContain("/dev/stdin")

      const stdin = readFileSync(join(captureDir, "stdin"), "utf8")
      expect(stdin).toContain("cluster: staging")
      expect(stdin).toContain("accessKey: AKIA")
      expect(stdin).toContain("name: staging-eu-backups")

      const written = readFileSync(credentialsPath({ dir, cluster: "staging" }), "utf8")
      expect(written.startsWith("ENCRYPTED\n")).toBe(true)
      expect(written).toContain("cluster: staging")
    }))

  it.effect("fails closed with a tagged error when the sops binary is missing from PATH", () =>
    Effect.gen(function*() {
      _emptyPathOnly()
      const dir = mkdtempSync(join(tmpdir(), "kumulo-secrets-dir-"))
      const failure = yield* Effect.flip(_runWrite({ dir, ageRecipient: "age1testrecipient", writeEntries: entries }))
      expect(failure._tag).toBe("SinkUnavailable")
    }))

  it.effect("fails closed with a tagged error on a non-zero sops exit", () =>
    Effect.gen(function*() {
      _installFakeSops("fake-sops-fail.sh")
      const dir = mkdtempSync(join(tmpdir(), "kumulo-secrets-dir-"))
      const failure = yield* Effect.flip(_runWrite({ dir, ageRecipient: "age1testrecipient", writeEntries: entries }))
      expect(failure._tag).toBe("SinkUnavailable")
      expect(failure.hint).toContain("no matching creation rules")
    }))

  it.effect("fails closed when no age recipient is configured", () =>
    Effect.gen(function*() {
      _installFakeSops("fake-sops.sh")
      const dir = mkdtempSync(join(tmpdir(), "kumulo-secrets-dir-"))
      const failure = yield* Effect.flip(_runWrite({ dir, ageRecipient: "", writeEntries: entries }))
      expect(failure._tag).toBe("SinkUnavailable")
      expect(failure.hint).toContain("recipient")
    }))

  it.effect("fails closed when entries carry no cluster key", () =>
    Effect.gen(function*() {
      _installFakeSops("fake-sops.sh")
      const dir = mkdtempSync(join(tmpdir(), "kumulo-secrets-dir-"))
      const failure = yield* Effect.flip(_runWrite({ dir, ageRecipient: "age1testrecipient", writeEntries: [_entry("s3.user", "x")] }))
      expect(failure._tag).toBe("SinkUnavailable")
      expect(failure.hint).toContain("cluster")
    }))
})
