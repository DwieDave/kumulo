import { resolve } from "node:path"
import { assert, describe, it } from "@effect/vitest"
import { ConfigProvider, Effect, Redacted, Sink, Stream } from "effect"
import { ChildProcessSpawner as ChildProcessSpawnerNS } from "effect/unstable/process"
import { requiredEnv, requiredRedactedEnv } from "../src/env.ts"
import { resolveSecretsFile, secretsConfigProvider } from "../src/secrets-file.ts"

type ChildProcessSpawnerService = (typeof ChildProcessSpawnerNS.ChildProcessSpawner)["Service"]

describe("resolveSecretsFile", () => {
  it("uses the parsed --secrets-file flag value", () => {
    assert.strictEqual(resolveSecretsFile({ flag: "a.yaml", env: {} }), "a.yaml")
  })

  it("falls back to KUMULO_SECRETS_FILE", () => {
    assert.strictEqual(resolveSecretsFile({ flag: undefined, env: { KUMULO_SECRETS_FILE: "env.yaml" } }), "env.yaml")
  })

  it("prefers the flag over the env var", () => {
    assert.strictEqual(
      resolveSecretsFile({ flag: "flag.yaml", env: { KUMULO_SECRETS_FILE: "env.yaml" } }),
      "flag.yaml"
    )
  })

  it("is undefined with neither flag nor env var", () => {
    assert.strictEqual(resolveSecretsFile({ flag: undefined, env: {} }), undefined)
  })

  it("is undefined for a blank flag or blank env var", () => {
    assert.strictEqual(resolveSecretsFile({ flag: " ", env: {} }), undefined)
    assert.strictEqual(resolveSecretsFile({ flag: undefined, env: { KUMULO_SECRETS_FILE: "  " } }), undefined)
  })
})

// kumulo: same in-memory `sops` stand-in as `packages/secrets-sops/test/provider.test.ts`
// — duplicated rather than exported from that package, since a fake spawner is
// test scaffolding and not part of the package's API.
const _fakeSpawner = (
  { stdout = "", stderr = "", exitCode = 0 }: { readonly stdout?: string; readonly stderr?: string; readonly exitCode?: number }
): ChildProcessSpawnerService =>
  ChildProcessSpawnerNS.make(() =>
    Effect.sync(() =>
      ChildProcessSpawnerNS.makeHandle({
        pid: ChildProcessSpawnerNS.ProcessId(1),
        exitCode: Effect.succeed(ChildProcessSpawnerNS.ExitCode(exitCode)),
        isRunning: Effect.succeed(false),
        kill: () => Effect.void,
        stdin: Sink.drain,
        stdout: Stream.encodeText(Stream.make(stdout)),
        stderr: Stream.encodeText(Stream.make(stderr)),
        all: Stream.encodeText(Stream.make(stdout, stderr)),
        getInputFd: () => Sink.drain,
        getOutputFd: () => Stream.empty,
        unref: Effect.succeed(Effect.void)
      })
    )
  )

const _withSecretsFile = (
  { file, ...spawn }: { readonly file: string; readonly stdout?: string; readonly stderr?: string; readonly exitCode?: number }
) =>
  Effect.provideService(
    ConfigProvider.ConfigProvider,
    secretsConfigProvider({ file, spawner: _fakeSpawner(spawn) })
  )

describe("secretsConfigProvider", () => {
  it.effect("serves a credential missing from the env out of the secrets file (R5)", () =>
    Effect.gen(function*() {
      const secret = yield* requiredRedactedEnv("KUMULO_TEST_HCLOUD_TOKEN").pipe(
        _withSecretsFile({ file: "secrets.yaml", stdout: `{"KUMULO_TEST_HCLOUD_TOKEN":"from-sops"}` })
      )
      assert.strictEqual(Redacted.value(secret), "from-sops")
      assert.notMatch(String(secret), /from-sops/)
    }))

  it.effect("prefers the real env var over the secrets file (R3)", () =>
    Effect.gen(function*() {
      process.env.KUMULO_TEST_OVH_CLIENT_ID = "from-env"
      const value = yield* requiredEnv("KUMULO_TEST_OVH_CLIENT_ID").pipe(
        _withSecretsFile({ file: "secrets.yaml", stdout: `{"KUMULO_TEST_OVH_CLIENT_ID":"from-sops"}` })
      ).pipe(Effect.ensuring(Effect.sync(() => { delete process.env.KUMULO_TEST_OVH_CLIENT_ID })))
      assert.strictEqual(value, "from-env")
    }))

  it.effect("still reports a var absent from both sources as a missing env var", () =>
    Effect.gen(function*() {
      const failure = yield* requiredEnv("KUMULO_TEST_ABSENT").pipe(
        _withSecretsFile({ file: "secrets.yaml", stdout: `{"OTHER":"x"}` }),
        Effect.flip
      )
      assert.strictEqual(failure._tag, "AuthenticationFailed")
      assert.match(failure.hint, /missing required env var KUMULO_TEST_ABSENT/)
    }))

  it.effect("surfaces the sops stderr and the resolved file path on a broken file (R6)", () =>
    Effect.gen(function*() {
      const failure = yield* requiredRedactedEnv("KUMULO_TEST_HCLOUD_TOKEN").pipe(
        _withSecretsFile({ file: "secrets.yaml", stderr: "Error: no key could decrypt\n", exitCode: 1 }),
        Effect.flip
      )
      assert.strictEqual(failure._tag, "AuthenticationFailed")
      assert.match(failure.hint, /no key could decrypt/)
      assert.include(failure.hint, resolve("secrets.yaml"))
      assert.notMatch(failure.hint, /missing required env var/)
    }))
})
