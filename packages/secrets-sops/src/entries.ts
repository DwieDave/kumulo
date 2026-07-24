import { Redacted } from "effect"
import type { CredentialEntry } from "@kumulo/core"

type Container = Array<unknown> | Record<string, unknown>

const _isDigits = (segment: string): boolean => /^\d+$/.test(segment)

const _isContainer = (value: unknown): value is Container => typeof value === "object" && value !== null

// `rest` is the remaining path *after* the segment being written now — used
// only to pick the shape (array vs object) of the segment being written.
const _emptyContainerFor = (rest: ReadonlyArray<string>): Container => rest[0] !== undefined && _isDigits(rest[0]) ? [] : {}

// kumulo: local mutation is contained to building one nested payload from
// scratch per `buildCredentialsPayload` call — nothing here is shared or
// observed mid-construction.
const _setAt = (container: Container, path: ReadonlyArray<string>, value: string): void => {
  const key = path[0]
  if (key === undefined) return
  const rest = path.slice(1)
  if (Array.isArray(container)) {
    const index = Number(key)
    if (rest.length === 0) {
      container[index] = value
      return
    }
    const current: unknown = container[index]
    const next: Container = _isContainer(current) ? current : _emptyContainerFor(rest)
    container[index] = next
    _setAt(next, rest, value)
    return
  }
  if (rest.length === 0) {
    container[key] = value
    return
  }
  const current: unknown = container[key]
  const next: Container = _isContainer(current) ? current : _emptyContainerFor(rest)
  container[key] = next
  _setAt(next, rest, value)
}

/**
 * Builds the nested credentials payload (R10 schema) from flat, dot-path
 * `CredentialEntry` keys — e.g. `"s3.buckets.0.name"` — unwrapping each
 * `Redacted` value. Numeric path segments build an array (`buckets[]`),
 * everything else builds a nested object.
 */
export const buildCredentialsPayload = (entries: ReadonlyArray<CredentialEntry>): Record<string, unknown> =>
  entries.reduce<Record<string, unknown>>((root, entry) => {
    _setAt(root, entry.key.split("."), Redacted.value(entry.value))
    return root
  }, {})
