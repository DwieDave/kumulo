import { describe, expect, it } from "@effect/vitest"
import { NodeFileSystem } from "@effect/platform-node"
import { Effect } from "effect"
import { chmodSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { writeKubeconfigFile } from "../../src/kubeconfig/write.ts"

describe("writeKubeconfigFile", () => {
  it.effect("writes the content with 0600 permissions", () =>
    Effect.gen(function*() {
      const dir = mkdtempSync(join(tmpdir(), "kumulo-kubeconfig-"))
      const path = join(dir, "kubeconfig")
      yield* writeKubeconfigFile({ path, content: "content" })
      expect(readFileSync(path, "utf8")).toBe("content")
      expect(statSync(path).mode & 0o777).toBe(0o600)
    }).pipe(Effect.provide(NodeFileSystem.layer)))

  it.effect("tightens an existing world-readable file", () =>
    Effect.gen(function*() {
      const dir = mkdtempSync(join(tmpdir(), "kumulo-kubeconfig-"))
      const path = join(dir, "kubeconfig")
      writeFileSync(path, "old")
      chmodSync(path, 0o644)
      yield* writeKubeconfigFile({ path, content: "new" })
      expect(readFileSync(path, "utf8")).toBe("new")
      expect(statSync(path).mode & 0o777).toBe(0o600)
    }).pipe(Effect.provide(NodeFileSystem.layer)))

  it.effect("fails with BootstrapFailed when the directory is missing", () =>
    Effect.gen(function*() {
      const error = yield* Effect.flip(writeKubeconfigFile({ path: "/nonexistent-kumulo-dir/kc", content: "x" }))
      expect(error._tag).toBe("BootstrapFailed")
    }).pipe(Effect.provide(NodeFileSystem.layer)))
})
