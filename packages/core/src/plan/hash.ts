// Key order must not affect the hash: two specs that differ only in
// property order describe the same resource.
const _canonical = (value: unknown): unknown =>
  Array.isArray(value)
    ? value.map(_canonical)
    : value !== null && typeof value === "object"
    ? Object.fromEntries(
      Object.entries(value)
        .toSorted(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, entry]) => [key, _canonical(entry)])
    )
    : value

// ponytail: FNV-1a 64-bit, not sha256 — core may only import 'effect', so no
// node:crypto, and this hash only detects drift (never authenticates anything).
const _fnv1a = (text: string): bigint =>
  [...text].reduce(
    (hash, char) => BigInt.asUintN(64, (hash ^ BigInt(char.codePointAt(0) ?? 0)) * 1099511628211n),
    14695981039346656037n
  )

// The one key providers stamp the hash under (hcloud label, Nova metadata).
export const CONFIG_HASH_KEY = "kumulo-config-hash"

export const configHash = (spec: unknown): string =>
  _fnv1a(JSON.stringify(_canonical(spec)) ?? "undefined").toString(16).padStart(16, "0")
