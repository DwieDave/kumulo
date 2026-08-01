import { CONFIG_HASH_KEY, configHash } from "@kumulo/core"
import type { UksLabel } from "./types.ts"

export const KUMULO_OWNER_LABEL_KEY = "kumulo-owner"

const _isValidKey = (key: string): boolean =>
  key.length >= 2 && key.length <= 32 && !key.startsWith("_") && [...key].every((char) => {
    const code = char.codePointAt(0) ?? 0
    return code >= 0x20 && code <= 0x7e
  })

const _isValidValue = (value: string): boolean => value.length <= 63 && /^[A-Za-z0-9\-_]*$/.test(value)

export const isValidLabel = ({ key, value }: UksLabel): boolean => _isValidKey(key) && _isValidValue(value)

export const ownershipLabels = ({ spec, owner }: { readonly spec: unknown; readonly owner: string }): ReadonlyArray<UksLabel> => [
  { key: CONFIG_HASH_KEY, value: configHash(spec) },
  { key: KUMULO_OWNER_LABEL_KEY, value: owner }
]
