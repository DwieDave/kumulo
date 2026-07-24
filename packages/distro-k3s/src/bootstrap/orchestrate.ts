import { Effect } from "effect"
import type { SshHost } from "../ssh/port.ts"
import type { NonEmptyMasters } from "./token.ts"

// Bounded-concurrency install orchestration: master 1 installs alone
// (other masters' `--server` join needs it already running), the rest of
// the masters then install in parallel; workers install in parallel under
// a bounded concurrency limit.
const DEFAULT_WORKER_CONCURRENCY = 10

export interface InstallMastersArgs<E, R> {
  readonly masters: NonEmptyMasters
  readonly installOne: (host: SshHost, isFirstMaster: boolean) => Effect.Effect<void, E, R>
}

/** Install master 1 serially, then the remaining masters in parallel. */
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

/** Install worker nodes in parallel, bounded by `concurrency` (default 10). */
export const installWorkers = <E, R>(args: InstallWorkersArgs<E, R>): Effect.Effect<void, E, R> =>
  Effect.forEach(args.workers, args.installOne, {
    concurrency: args.concurrency ?? DEFAULT_WORKER_CONCURRENCY,
    discard: true
  })
