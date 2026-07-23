import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import { mkdtempSync, readFileSync, statSync } from "node:fs"
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
    }))
})
