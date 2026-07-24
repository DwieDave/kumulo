// kumulo.config-hash tags a resource with a hash of "the relevant
// spec" so drift/no-op/replace can be decided without a state file. Stability
// (same spec, any key order -> same hash) matters more than cryptographic
// strength here, so a small FNV-1a over a recursively key-sorted JSON
// stringification is enough — no extra dependency needed.
const _isPlainObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value)

const _sortKeysDeep = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(_sortKeysDeep)
  if (_isPlainObject(value)) {
    const sorted: Record<string, unknown> = {}
    for (const key of Object.keys(value).toSorted()) {
      sorted[key] = _sortKeysDeep(value[key])
    }
    return sorted
  }
  return value
}

const _fnv1a = (input: string): string => {
  let hash = 0x811c9dc5
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, "0")
}

export const configHash = (spec: unknown): string => _fnv1a(JSON.stringify(_sortKeysDeep(spec)))
