import { Duration } from "effect"

const _UNIX_SECONDS_FLOOR = 1_000_000_000

export const parseRetryAfterAt = (
  { nowMs, value }: { readonly value: string | undefined; readonly nowMs: number }
): Duration.Duration | undefined => {
  if (value === undefined || value.trim() === "") return undefined
  const seconds = Number(value)

  if (Number.isFinite(seconds) && seconds >= 0) return Duration.seconds(seconds)
  const at = Date.parse(value)

  if (Number.isNaN(at)) return undefined

  return Duration.millis(Math.max(at - nowMs, 0))
}

// delta seconds or an HTTP date; uncapped, callers apply their own ceiling
export const parseRetryAfter = (value: string | undefined): Duration.Duration | undefined =>
  parseRetryAfterAt({ value, nowMs: Date.now() })

// RateLimit-Reset is either delta seconds or an absolute unix timestamp
export const parseRateLimitResetAt = (
  { nowMs, value }: { readonly value: string | undefined; readonly nowMs: number }
): Duration.Duration | undefined => {
  if (value === undefined || value.trim() === "") return undefined
  const n = Number(value)

  if (!Number.isFinite(n) || n < 0) return undefined

  if (n >= _UNIX_SECONDS_FLOOR) return Duration.millis(Math.max(n * 1000 - nowMs, 0))

  return Duration.seconds(n)
}

export const parseRateLimitReset = (value: string | undefined): Duration.Duration | undefined =>
  parseRateLimitResetAt({ value, nowMs: Date.now() })
