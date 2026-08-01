import { Effect, Option } from "effect"
import { randomBytes } from "node:crypto"
import { Ssh } from "../ssh/port.ts"
import type { SshHost } from "../ssh/port.ts"

export type NonEmptyMasters = readonly [SshHost, ...Array<SshHost>]

const NODE_TOKEN_PATH = "/var/lib/rancher/k3s/server/node-token"

const _readToken = (host: SshHost): Effect.Effect<Option.Option<string>, never, Ssh> =>
  Effect.gen(function*() {
    const ssh = yield* Ssh
    return yield* ssh.readFile(host, NODE_TOKEN_PATH).pipe(
      Effect.match({ onFailure: () => Option.none(), onSuccess: (content) => Option.some(content.trim()) })
    )
  })

const _parseMtime = (out: string): Option.Option<number> => {
  const n = Number.parseInt(out.trim(), 10)
  return Number.isNaN(n) ? Option.none() : Option.some(n)
}

const _readMtime = (host: SshHost): Effect.Effect<Option.Option<number>, never, Ssh> =>
  Effect.gen(function*() {
    const ssh = yield* Ssh
    return yield* ssh.exec(host, `stat -c %Y ${NODE_TOKEN_PATH} 2>/dev/null`).pipe(
      Effect.match({ onFailure: () => Option.none(), onSuccess: _parseMtime })
    )
  })

const _mostFrequent = (tokens: ReadonlyArray<string>): Option.Option<string> => {
  if (tokens.length === 0) return Option.none()
  const counts = new Map<string, number>()
  for (const token of tokens) counts.set(token, (counts.get(token) ?? 0) + 1)
  let best: string | undefined
  let bestCount = -1
  for (const [token, count] of counts) {
    if (count > bestCount) {
      best = token
      bestCount = count
    }
  }
  return best === undefined ? Option.none() : Option.some(best)
}

const _randomToken = (): string => randomBytes(32).toString("hex")

export interface ResolvedToken {
  readonly token: string
  readonly firstMaster: SshHost
}

// Oldest token-file mtime wins, so the survivor of the earliest bootstrap stays "master 1" on reruns.
const _oldestBearer = (
  masters: NonEmptyMasters,
  bearers: ReadonlyArray<{ readonly host: SshHost; readonly mtime: Option.Option<number> }>
): SshHost => {
  const withToken = bearers.filter((b) => Option.isSome(b.mtime))
  if (withToken.length === 0) return masters[0]
  return withToken.reduce((oldest, next) =>
    Option.getOrThrow(next.mtime) < Option.getOrThrow(oldest.mtime) ? next : oldest
  ).host
}

export const resolveToken = (masters: NonEmptyMasters): Effect.Effect<ResolvedToken, never, Ssh> =>
  Effect.gen(function*() {
    const reads = yield* Effect.forEach(masters, (host) =>
      _readToken(host).pipe(Effect.map((token) => ({ host, token }))), { concurrency: masters.length || 1 })
    const tokens = reads.flatMap((r) => (Option.isSome(r.token) ? [Option.getOrThrow(r.token)] : []))
    const quorum = _mostFrequent(tokens)

    if (Option.isNone(quorum)) {
      return { token: _randomToken(), firstMaster: masters[0] }
    }

    const resolvedToken = Option.getOrThrow(quorum)
    const bearers = reads.filter((r) => Option.isSome(r.token) && Option.getOrThrow(r.token) === resolvedToken)
    const withMtimes = yield* Effect.forEach(bearers, (b) =>
      _readMtime(b.host).pipe(Effect.map((mtime) => ({ host: b.host, mtime }))), { concurrency: bearers.length || 1 })

    return { token: resolvedToken, firstMaster: _oldestBearer(masters, withMtimes) }
  })
