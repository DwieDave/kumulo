import { describe, expect, it } from "@effect/vitest"
import { Config, ConfigProvider, Effect, Schema, Sink, Stream } from "effect"
import { ChildProcess as ChildProcessNS, ChildProcessSpawner as ChildProcessSpawnerNS } from "effect/process"
import type { ChildProcess, CommandLine } from "effect/process"
import { decryptSopsFile, sopsConfigProvider } from "../src/provider.ts"

type Invocation = { readonly command: string; readonly args: ReadonlyArray<CommandLine.Word> }

const _fakeSpawner = (
  { stdout = "", stderr = "", exitCode = 0 }: { readonly stdout?: string; readonly stderr?: string; readonly exitCode?: number }
) => {
  const invocations: Array<Invocation> = []

  const spawner = ChildProcessSpawnerNS.make((command: ChildProcess.Command) =>
    Effect.sync(() => {
      if (ChildProcessNS.isStandardCommand(command)) invocations.push({ command: command.command, args: command.args })

      return ChildProcessSpawnerNS.makeHandle({
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
    })
  )

  return { spawner, invocations }
}

describe("decryptSopsFile", () => {
  it.effect("invokes sops with --decrypt --output-type json and returns the flat record", () =>
    Effect.gen(function*() {
      const { invocations, spawner } = _fakeSpawner({ stdout: `{"HCLOUD_TOKEN":"tok","OVH_CLIENT_ID":"id"}` })
      const secrets = yield* decryptSopsFile({ file: "/secrets/staging.yaml", spawner })
      expect(secrets).toEqual({ HCLOUD_TOKEN: "tok", OVH_CLIENT_ID: "id" })
      expect(invocations).toEqual([
        { command: "sops", args: ["--decrypt", "--output-type", "json", "/secrets/staging.yaml"] }
      ])
    }))

  it.effect("fails with the file path and sops stderr on a non-zero exit", () =>
    Effect.gen(function*() {
      const { spawner } = _fakeSpawner({ stderr: "Error: no key could decrypt\n", exitCode: 1 })
      const failure = yield* Effect.flip(decryptSopsFile({ file: "/secrets/staging.yaml", spawner }))
      expect(failure._tag).toBe("SourceError")
      expect(failure.message).toContain("/secrets/staging.yaml")
      expect(failure.message).toContain("no key could decrypt")
    }))

  it.effect("fails when sops stdout is not valid JSON", () =>
    Effect.gen(function*() {
      const { spawner } = _fakeSpawner({ stdout: "not json" })
      const failure = yield* Effect.flip(decryptSopsFile({ file: "/secrets/staging.yaml", spawner }))
      expect(failure._tag).toBe("SourceError")
      expect(failure.message).toContain("/secrets/staging.yaml")
    }))

  it.effect("fails when a value is not a string", () =>
    Effect.gen(function*() {
      const { spawner } = _fakeSpawner({ stdout: `{"HCLOUD_TOKEN":"tok","nested":{"a":"b"}}` })
      const failure = yield* Effect.flip(decryptSopsFile({ file: "/secrets/staging.yaml", spawner }))
      expect(failure._tag).toBe("SourceError")
      expect(failure.message).toContain("nested")
    }))

  it.effect("fails when the decrypted document is not an object", () =>
    Effect.gen(function*() {
      const { spawner } = _fakeSpawner({ stdout: `["a"]` })
      const failure = yield* Effect.flip(decryptSopsFile({ file: "/secrets/staging.yaml", spawner }))
      expect(failure._tag).toBe("SourceError")
    }))
})

const _read = (provider: ConfigProvider.ConfigProvider, key: string) =>
  Effect.provideService(Config.String(key), ConfigProvider.ConfigProvider, provider)

describe("sopsConfigProvider", () => {
  it.effect("serves decrypted keys to Config reads", () =>
    Effect.gen(function*() {
      const { spawner } = _fakeSpawner({ stdout: `{"HCLOUD_TOKEN":"tok"}` })
      const provider = sopsConfigProvider({ file: "/secrets/staging.yaml", spawner })
      expect(yield* _read(provider, "HCLOUD_TOKEN")).toBe("tok")
    }))

  it.effect("reports a key absent from the file as missing", () =>
    Effect.gen(function*() {
      const { spawner } = _fakeSpawner({ stdout: `{"HCLOUD_TOKEN":"tok"}` })
      const provider = sopsConfigProvider({ file: "/secrets/staging.yaml", spawner })
      expect(yield* Effect.flip(_read(provider, "OVH_CLIENT_ID"))).toBeDefined()
    }))

  it("does not spawn sops until the first read (R4)", () => {
    const { invocations, spawner } = _fakeSpawner({ stdout: `{"HCLOUD_TOKEN":"tok"}` })
    sopsConfigProvider({ file: "/secrets/staging.yaml", spawner })
    expect(invocations).toHaveLength(0)
  })

  it.effect("decrypts at most once across many reads, sequential and concurrent (R4)", () =>
    Effect.gen(function*() {
      const { invocations, spawner } = _fakeSpawner({ stdout: `{"A":"1","B":"2"}` })
      const provider = sopsConfigProvider({ file: "/secrets/staging.yaml", spawner })
      yield* Effect.all([_read(provider, "A"), _read(provider, "B")], { concurrency: "unbounded" })
      yield* _read(provider, "A")
      expect(invocations).toHaveLength(1)
    }))

  it.effect("spawns sops at most once even when decryption fails (R4)", () =>
    Effect.gen(function*() {
      const { invocations, spawner } = _fakeSpawner({ stderr: "Error: no key could decrypt\n", exitCode: 1 })
      const provider = sopsConfigProvider({ file: "/secrets/staging.yaml", spawner })
      yield* Effect.flip(_read(provider, "A"))
      yield* Effect.flip(_read(provider, "B"))
      expect(invocations).toHaveLength(1)
    }))

  it.effect("surfaces the file path and sops stderr on a failing read (R6)", () =>
    Effect.gen(function*() {
      const { spawner } = _fakeSpawner({ stderr: "Error: no key could decrypt\n", exitCode: 1 })
      const provider = sopsConfigProvider({ file: "/secrets/staging.yaml", spawner })
      const failure = yield* Effect.flip(_read(provider, "HCLOUD_TOKEN"))
      const rendered = JSON.stringify(failure)
      expect(rendered).toContain("/secrets/staging.yaml")
      expect(rendered).toContain("no key could decrypt")
    }))

  it.effect("env values win when the sops provider is the fallback (R3)", () =>
    Effect.gen(function*() {
      const { spawner } = _fakeSpawner({ stdout: `{"A":"from-sops","B":"from-sops"}` })

      const provider = ConfigProvider.orElse(
        ConfigProvider.fromEnv({ env: { A: "from-env" } }),
        sopsConfigProvider({ file: "/secrets/staging.yaml", spawner })
      )

      expect(yield* _read(provider, "A")).toBe("from-env")
      expect(yield* _read(provider, "B")).toBe("from-sops")
    }))

  const _pairs = Schema.Array(
    Schema.Tuple([
      Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(12), Schema.isPattern(/^[A-Z_]+$/)),
      Schema.String.check(Schema.isMaxLength(20))
    ])
  )

  it.effect.prop(
    "every key of an arbitrary flat string record round-trips through the provider (R1)",
    [_pairs],
    ([raw]) =>
      Effect.gen(function*() {
        const secrets: Record<string, string> = Object.fromEntries(new Map(raw))
        const { invocations, spawner } = _fakeSpawner({ stdout: JSON.stringify(secrets) })
        const provider = sopsConfigProvider({ file: "/secrets/staging.yaml", spawner })
        const values = yield* Effect.forEach(Object.keys(secrets), (key) => _read(provider, key))
        expect(values).toEqual(Object.values(secrets))
        expect(invocations.length).toBeLessThanOrEqual(1)
      })
  )
})
