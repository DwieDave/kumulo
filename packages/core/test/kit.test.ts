import { describe, expect, it } from "@effect/vitest"
import { Effect, Ref, Schema } from "effect"
import { layerNoop } from "effect/FileSystem"
import { ResourceNotFound } from "../src/errors/tagged.ts"
import { makeOutputsFile } from "../src/outputs/index.ts"
import { paginate, paginateByOffset, paginateByPage } from "../src/paginate.ts"
import { createOrNoOp, deleteRow, PlanAction } from "../src/plan/index.ts"
import { pollUntil } from "../src/reconcile/poll.ts"
import { diffBuckets } from "../src/storage/diff.ts"

describe("paginate", () => {
  it.effect("walks cursor pages to the end", () =>
    Effect.gen(function*() {
      const pages = new Map<string, { items: Array<number>; next?: string }>([
        ["a", { items: [1, 2], next: "b" }],
        ["b", { items: [3] }]
      ])

      const all = yield* paginate({
        initial: "a",
        fetch: (cursor) => Effect.succeed(pages.get(cursor) ?? { items: [] }),
        items: (page) => page.items,
        next: ({ page }) => page.next,
        maxPages: 5
      })

      expect(all).toEqual([1, 2, 3])
    }))

  it.effect("fails when maxPages is reached", () =>
    Effect.gen(function*() {
      const error = yield* paginateByPage({
        fetch: (n) => Effect.succeed([n]),
        items: (page) => page,
        perPage: 1,
        maxPages: 3
      }).pipe(Effect.flip)

      expect(error._tag).toBe("PaginationLimitExceeded")
    }))

  it.effect("fails when the cursor does not advance", () =>
    Effect.gen(function*() {
      const error = yield* paginate({
        initial: "x",
        fetch: () => Effect.succeed(["i"]),
        items: (page) => page,
        next: () => "x",
        maxPages: 10
      }).pipe(Effect.flip)

      expect(error._tag).toBe("PaginationStalled")
    }))

  it.effect("offset style stops on a short page", () =>
    Effect.gen(function*() {
      const all = yield* paginateByOffset({
        fetch: (offset) => Effect.succeed(offset === 0 ? [1, 2] : [3]),
        items: (page) => page,
        limit: 2,
        maxPages: 5
      })

      expect(all).toEqual([1, 2, 3])
    }))
})

describe("pollUntil options", () => {
  it.live("tolerates not-found a bounded number of times", () =>
    Effect.gen(function*() {
      const calls = yield* Ref.make(0)

      const check = Ref.updateAndGet(calls, (n) => n + 1).pipe(
        Effect.flatMap((n) => n < 3 ? Effect.fail(new ResourceNotFound({ kind: "k", ref: "r" })) : Effect.succeed("OK"))
      )

      const base = { isDone: (s: string) => s === "OK", interval: "1 millis", timeout: "1 second", kind: "k", ref: "r" } as const

      expect(yield* pollUntil({ ...base, check, tolerateNotFound: 5 })).toBe("OK")

      yield* Ref.set(calls, 0)
      const error = yield* pollUntil({ ...base, check, tolerateNotFound: 1 }).pipe(Effect.flip)

      expect(error._tag).toBe("ResourceNotFound")
    }))

  it.live("isFailed fails fast", () =>
    Effect.gen(function*() {
      const error = yield* pollUntil({
        check: Effect.succeed("ERROR"),
        isDone: (s: string) => s === "OK",
        isFailed: (s: string) => s === "ERROR",
        interval: "1 millis",
        timeout: "1 second",
        kind: "k",
        ref: "r"
      }).pipe(Effect.flip)

      expect(error._tag).toBe("ProviderApiError")
    }))

  it.live("onTimeout replaces the default error", () =>
    Effect.gen(function*() {
      const error = yield* pollUntil({
        check: Effect.succeed("X"),
        isDone: () => false,
        interval: "1 millis",
        timeout: "10 millis",
        kind: "k",
        ref: "r",
        onTimeout: (last) => ({ custom: last })
      }).pipe(Effect.flip)

      expect(error).toEqual({ custom: "X" })
    }))
})

describe("makeOutputsFile", () => {
  const file = makeOutputsFile({
    schema: Schema.Struct({ cluster: Schema.NonEmptyString, items: Schema.Array(Schema.String) }),
    suffix: "things",
    empty: (tag) => ({ cluster: tag, items: [] }),
    clusterOf: (f) => f.cluster
  })

  it("builds the path", () => {
    expect(file.path({ dir: "/d/", tag: "c", format: "json" })).toBe("/d/c.things.json")
  })

  it.effect("missing file reads empty", () =>
    file.read({ dir: "/d", tag: "c" }).pipe(
      Effect.map((f) => expect(f).toEqual({ cluster: "c", items: [] })),
      Effect.provide(layerNoop({ exists: () => Effect.succeed(false) }))
    ))

  it.effect("writes via temp file then rename with mode 0600", () =>
    Effect.gen(function*() {
      const calls: Array<string> = []

      const fs = layerNoop({
        writeFileString: (path, _data, options) => Effect.sync(() => void calls.push(`write ${path.endsWith(".yaml") ? "target" : "tmp"} ${options?.mode}`)),
        rename: (from, to) => Effect.sync(() => void calls.push(`rename ${from.includes(".tmp-")} ${to}`))
      })

      yield* file.write({ dir: "/d", file: { cluster: "c", items: ["a"] } }).pipe(Effect.provide(fs))

      expect(calls).toEqual([`write tmp ${0o600}`, "rename true /d/c.things.yaml"])
      expect(file.stringify({ file: { cluster: "c", items: ["a"] } })).toBe("cluster: c\nitems:\n  - a\n")
    }))
})

describe("diffBuckets", () => {
  it("classifies create, replace, update, delete, noop", () => {
    type Spec = { name: string; region: string; v: boolean }

    type Ex = Spec & { retain: boolean }

    const result = diffBuckets<Spec, Ex>({
      desired: [
        { name: "new", region: "a", v: false },
        { name: "moved", region: "b", v: false },
        { name: "ver", region: "a", v: true },
        { name: "same", region: "a", v: false }
      ],
      existing: [
        { name: "moved", region: "a", v: false, retain: false },
        { name: "ver", region: "a", v: false, retain: false },
        { name: "same", region: "a", v: false, retain: false },
        { name: "gone", region: "a", v: false, retain: false },
        { name: "kept", region: "a", v: false, retain: true }
      ],
      isImmutable: (s, e) => s.region !== e.region,
      isMutable: (s, e) => s.v !== e.v
    })

    expect(result.toCreate.map((s) => s.name)).toEqual(["new"])
    expect(result.toReplace.map((r) => r.existing.name)).toEqual(["moved"])
    expect(result.toUpdate.map((r) => r.existing.name)).toEqual(["ver"])
    expect(result.toDelete.map((e) => e.name)).toEqual(["gone"])
    expect(result.noop.map((e) => e.name)).toEqual(["same"])
  })
})

describe("plan rows", () => {
  it("deleteRow texts", () => {
    expect(deleteRow({ name: "x", live: false, retain: true })).toEqual(PlanAction.NoOp({ name: "x (already absent)" }))
    expect(deleteRow({ name: "x", live: true, retain: true })).toEqual(PlanAction.NoOp({ name: "x (retained)" }))
    expect(deleteRow({ name: "x", live: true, retain: false })).toEqual(PlanAction.Delete({ name: "x" }))
  })

  it("createOrNoOp", () => {
    expect(createOrNoOp({ exists: true, name: "x" })._tag).toBe("NoOp")
    expect(createOrNoOp({ exists: false, name: "x" })._tag).toBe("Create")
  })
})
