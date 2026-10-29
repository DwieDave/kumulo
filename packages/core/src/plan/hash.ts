import { Predicate } from "effect"

const _compareKeys = ([a]: readonly [string, unknown], [b]: readonly [string, unknown]): number => (a < b ? -1 : a > b ? 1 : 0)

// FNV-1a 64-bit, not sha256 — no node:crypto in core, and this only detects drift, never authenticates.
const _fnv1a = (text: string): bigint =>
  [...text].reduce(
    (hash, char) => BigInt.asUintN(64, (hash ^ BigInt(char.codePointAt(0) ?? 0)) * 1099511628211n),
    14695981039346656037n
  )

export const CONFIG_HASH_KEY = "kumulo-config-hash"

export const configHash = <Spec>(spec: Spec): string =>
  _fnv1a(JSON.stringify(spec, (_key, value) => Predicate.isObject(value) ? Object.fromEntries(Object.entries(value).toSorted(_compareKeys)) : value) ?? "undefined").toString(16).padStart(16, "0")
