import { assert, it } from "@effect/vitest"
import { Effect, Schema } from "effect"
import { Cloud_kube_NodePoolTemplateMetadata } from "../../src/generated/client.ts"

// kumulo: see packages/hetzner/client/test/generated/freeform-map.test.ts for the WHY — MKS node
// pool `labels`/`annotations` are free-form string maps and must generate as a real
// `Schema.Record`, not `Schema.Struct({})`.
const _roundTrip = (value: typeof Cloud_kube_NodePoolTemplateMetadata.Encoded) =>
  Effect.runSync(
    Schema.encodeUnknownEffect(Cloud_kube_NodePoolTemplateMetadata)(value).pipe(
      Effect.flatMap(Schema.decodeUnknownEffect(Cloud_kube_NodePoolTemplateMetadata))
    )
  )

it.prop("mks labels/annotations round-trip with arbitrary keys", [Schema.Record(Schema.String, Schema.String), Schema.Record(Schema.String, Schema.String)], ([labels, annotations]) => {
  const decoded = _roundTrip({ labels, annotations, finalizers: [] })
  assert.deepStrictEqual(decoded.labels, labels)
  assert.deepStrictEqual(decoded.annotations, annotations)
})

it("mks labels are typed, not an open empty struct", () => {
  const error = Effect.runSync(
    Effect.flip(
      Schema.decodeUnknownEffect(Cloud_kube_NodePoolTemplateMetadata)({ labels: { a: 1 }, annotations: {}, finalizers: [] })
    )
  )

  assert.isDefined(error)
})
