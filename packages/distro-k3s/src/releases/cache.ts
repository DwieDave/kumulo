import { Effect, Ref } from "effect"
import { ConfigInvalid } from "@kumulo/core"
import type { ResolvedVersion } from "@kumulo/core"
import { K3S_RELEASE_FIXTURE } from "./fixture.ts"

const DEFAULT_TTL_MS = 60 * 60 * 1000

export interface ReleaseCache {
  readonly list: Effect.Effect<ReadonlyArray<string>>
  readonly validateVersion: (v: string) => Effect.Effect<ResolvedVersion, ConfigInvalid>
}

export interface MakeReleaseCacheArgs {
  // kumulo: WHY injected instead of a live GitHub fetch — tests stay offline;
  // production wiring can pass a real fetcher later.
  readonly source?: () => ReadonlyArray<string>
  readonly ttlMs?: number
  readonly now?: () => number
}

// `releases` lists k3s versions with a TTL cache; `validateVersion` rejects
// anything not in that list.
export const makeReleaseCache = (args: MakeReleaseCacheArgs = {}): Effect.Effect<ReleaseCache> =>
  Effect.gen(function*() {
    const source = args.source ?? (() => K3S_RELEASE_FIXTURE)
    const ttlMs = args.ttlMs ?? DEFAULT_TTL_MS
    const now = args.now ?? (() => Date.now())
    const cache = yield* Ref.make<{ readonly versions: ReadonlyArray<string>; readonly fetchedAt: number } | undefined>(
      undefined
    )

    const list: Effect.Effect<ReadonlyArray<string>> = Ref.get(cache).pipe(
      Effect.flatMap((entry) => {
        if (entry !== undefined && now() - entry.fetchedAt < ttlMs) return Effect.succeed(entry.versions)
        const versions = source()
        return Ref.set(cache, { versions, fetchedAt: now() }).pipe(Effect.as(versions))
      })
    )

    const validateVersion = (v: string): Effect.Effect<ResolvedVersion, ConfigInvalid> =>
      list.pipe(
        Effect.flatMap((versions) =>
          versions.includes(v)
            ? Effect.succeed({ value: v })
            : Effect.fail(new ConfigInvalid({ issues: [{ path: ["version"], message: `unknown k3s version: ${v}` }] }))
        )
      )

    return { list, validateVersion }
  })
