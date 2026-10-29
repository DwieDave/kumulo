import { Predicate, Redacted } from "effect"
import type { Schema } from "effect"
import type { CredentialEntry } from "@kumulo/core"

type Container = Schema.MutableJsonArray | Schema.MutableJsonObject

const _isDigits = (segment: string): boolean => /^\d+$/.test(segment)

const _isContainer = (value: Schema.MutableJson | undefined): value is Container => Array.isArray(value) || Predicate.isObject(value)

const _emptyContainerFor = (rest: ReadonlyArray<string>): Container => rest[0] !== undefined && _isDigits(rest[0]) ? [] : {}

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

    const current: Schema.MutableJson | undefined = container[index]
    const next: Container = _isContainer(current) ? current : _emptyContainerFor(rest)
    container[index] = next
    _setAt(next, rest, value)

    return
  }

  if (rest.length === 0) {
    container[key] = value

    return
  }

  const current: Schema.MutableJson | undefined = container[key]
  const next: Container = _isContainer(current) ? current : _emptyContainerFor(rest)
  container[key] = next
  _setAt(next, rest, value)
}

export const buildCredentialsPayload = (entries: ReadonlyArray<CredentialEntry>): Schema.MutableJsonObject =>
  entries.reduce<Schema.MutableJsonObject>((root, entry) => {
    _setAt(root, entry.key.split("."), Redacted.value(entry.value))

    return root
  }, {})
