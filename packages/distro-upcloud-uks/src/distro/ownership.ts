/**
 * Ownership stamping (D14/R11). UKS labels are `[{key, value}]` pairs with
 * their own charset rules — distinct from k8s label rules, so this is not
 * reusing anything core exports. Core's `configHash`/`CONFIG_HASH_KEY`
 * already fit those rules with room to spare (16 lowercase hex chars, key
 * `kumulo-config-hash`); `isValidLabel` is the proof, not an encoding layer.
 */

import { CONFIG_HASH_KEY, configHash } from "@kumulo/core"
import type { UksLabel } from "./types.ts"

/** The label kumulo stamps its owner marker under — shared with node-group labelling (M5). */
export const KUMULO_OWNER_LABEL_KEY = "kumulo-owner"

const _isValidKey = (key: string): boolean =>
  key.length >= 2 && key.length <= 32 && !key.startsWith("_") && [...key].every((char) => {
    const code = char.codePointAt(0) ?? 0
    return code >= 0x20 && code <= 0x7e
  })

const _isValidValue = (value: string): boolean => value.length <= 63 && /^[A-Za-z0-9\-_]*$/.test(value)

/** UpCloud's label rules (D14): key 2-32 printable ASCII not starting with `_`, value 0-63 of `[A-Za-z0-9-_]`. */
export const isValidLabel = ({ key, value }: UksLabel): boolean => _isValidKey(key) && _isValidValue(value)

/**
 * The ownership pair every kumulo-managed cluster/node-group is stamped
 * with: the drift hash (T4.1/T4.2 compare against this) and an owner
 * marker distinguishing kumulo-managed resources from hand-made ones.
 */
export const ownershipLabels = ({ spec, owner }: { readonly spec: unknown; readonly owner: string }): ReadonlyArray<UksLabel> => [
  { key: CONFIG_HASH_KEY, value: configHash(spec) },
  { key: KUMULO_OWNER_LABEL_KEY, value: owner }
]
