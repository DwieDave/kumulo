import { Schema } from "effect"
import { assert, it } from "@effect/vitest"
import { hasClusterLabel, matchesVolumeLabels, volumeLabels } from "../src/labels.ts"

const _tag = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(20))
const _name = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(20))

it.prop("a volume's own stamped labels always match itself", [_tag, _name], ([tag, name]) => {
  const labels = volumeLabels({ tag, name })
  assert.isTrue(matchesVolumeLabels({ labels, tag, name }))
  assert.isTrue(hasClusterLabel({ labels, tag }))
})

it.prop(
  "labels stamped for one tag/name never match a different tag or name",
  [_tag, _name, _tag, _name],
  ([tag, name, otherTag, otherName]) => {
    if (tag === otherTag && name === otherName) return
    const labels = volumeLabels({ tag, name })
    assert.isFalse(matchesVolumeLabels({ labels, tag: otherTag, name: otherName }))
  }
)

it("undefined labels never match", () => {
  assert.isFalse(matchesVolumeLabels({ labels: undefined, tag: "a", name: "b" }))
  assert.isFalse(hasClusterLabel({ labels: undefined, tag: "a" }))
})
