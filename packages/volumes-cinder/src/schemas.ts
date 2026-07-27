import { ResponseDecodeError } from "@kumulo/core"
import { Effect } from "effect"
import * as Schema from "effect/Schema"

// kumulo: only the fields this provider consumes — Cinder's real
// volume payload carries many more (status, attachments, ...) left
// undeclared and ignored on decode.
const VolumeMetadata = Schema.Struct({
  kumulo_cluster: Schema.optionalKey(Schema.String)
})

export const VolumeRecord = Schema.Struct({
  // kumulo: `id` is required — an id-less record would flow downstream as
  // `VolumeInfo{id:""}` and address the wrong (or no) billed resource.
  id: Schema.NonEmptyString,
  name: Schema.optionalKey(Schema.String),
  metadata: Schema.optionalKey(VolumeMetadata)
})
export type VolumeRecord = typeof VolumeRecord.Type

const VolumeLink = Schema.Struct({ rel: Schema.String, href: Schema.String })

export const VolumesList = Schema.Struct({
  volumes: Schema.Array(VolumeRecord),
  volumes_links: Schema.optionalKey(Schema.Array(VolumeLink))
})
export type VolumesList = typeof VolumesList.Type

const VolumeSingle = Schema.Struct({ volume: VolumeRecord })

// A malformed body is a decode failure and nothing else — never an auth
// error, and never swallowed into `[]`/`{}` (that made `ensureVolume`
// create a duplicate billed volume).
export const decodeVolumesList = (value: unknown): Effect.Effect<VolumesList, ResponseDecodeError> =>
  Schema.decodeUnknownEffect(VolumesList)(value).pipe(
    Effect.mapError((error) => new ResponseDecodeError({ endpoint: "volumes/detail", issue: error.issue }))
  )

export const decodeVolumeSingle = (value: unknown): Effect.Effect<VolumeRecord, ResponseDecodeError> =>
  Schema.decodeUnknownEffect(VolumeSingle)(value).pipe(
    Effect.map((decoded) => decoded.volume),
    Effect.mapError((error) => new ResponseDecodeError({ endpoint: "volumes", issue: error.issue }))
  )

// kumulo: Cinder paginates `volumes/detail` — `volumes_links` carries a
// rel:"next" href whose `marker` query param is the last seen volume id.
export const nextMarker = (list: VolumesList): string | undefined => {
  const next = list.volumes_links?.find((link) => link.rel === "next")
  if (next === undefined) return undefined
  const marker = new URL(next.href, "http://cinder.invalid/").searchParams.get("marker")
  return marker ?? list.volumes.at(-1)?.id
}
