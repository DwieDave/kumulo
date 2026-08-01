import { Effect } from "effect"
import type { SshHost } from "../ssh/port.ts"
import type { NonEmptyMasters } from "./token.ts"

// Master 1 must install alone first — other masters' `--server` join needs it already running.
const DEFAULT_WORKER_CONCURRENCY = 10

export interface InstallMastersArgs<E, R> {
  readonly masters: NonEmptyMasters
  readonly installOne: (host: SshHost, isFirstMaster: boolean) => Effect.Effect<void, E, R>
}

export const installMasters = <E, R>(args: InstallMastersArgs<E, R>): Effect.Effect<void, E, R> =>
  Effect.gen(function*() {
    const [firstMaster, ...rest] = args.masters
    yield* args.installOne(firstMaster, true)
    yield* Effect.forEach(rest, (host) => args.installOne(host, false), { concurrency: "unbounded", discard: true })
  })

export interface InstallWorkersArgs<E, R> {
  readonly workers: ReadonlyArray<SshHost>
  readonly installOne: (host: SshHost) => Effect.Effect<void, E, R>
  readonly concurrency?: number
}

export const installWorkers = <E, R>(args: InstallWorkersArgs<E, R>): Effect.Effect<void, E, R> =>
  Effect.forEach(args.workers, args.installOne, {
    concurrency: args.concurrency ?? DEFAULT_WORKER_CONCURRENCY,
    discard: true
  })
