import { Effect } from "effect"
import * as Schema from "effect/Schema"

// kumulo: only the fields this provider consumes — Cinder's real
// volume payload carries many more (status, attachments, ...) left
// undeclared and ignored on decode.
const VolumeMetadata = Schema.Struct({
  kumulo_cluster: Schema.optionalKey(Schema.String)
})

export const VolumeRecord = Schema.Struct({
  id: Schema.optionalKey(Schema.String),
  name: Schema.optionalKey(Schema.String),
  metadata: Schema.optionalKey(VolumeMetadata)
})
export type VolumeRecord = typeof VolumeRecord.Type

const VolumesList = Schema.Struct({ volumes: Schema.Array(VolumeRecord) })
const VolumeSingle = Schema.Struct({ volume: VolumeRecord })

// kumulo: `VolumeProvider`'s error channel (`VolumeError`) has no
// decode-failure variant — same as the old `isRecord`/`field` guards, a
// malformed/missing list or object silently falls back to "nothing here"
// rather than surfacing a new error (preserves pre-refactor semantics).
export const decodeVolumesList = (value: unknown): Effect.Effect<ReadonlyArray<VolumeRecord>, never> =>
  Schema.decodeUnknownEffect(VolumesList)(value).pipe(
    Effect.map((decoded) => decoded.volumes),
    Effect.orElseSucceed((): ReadonlyArray<VolumeRecord> => [])
  )

export const decodeVolumeSingle = (value: unknown): Effect.Effect<VolumeRecord, never> =>
  Schema.decodeUnknownEffect(VolumeSingle)(value).pipe(
    Effect.map((decoded) => decoded.volume),
    Effect.orElseSucceed((): VolumeRecord => ({}))
  )
