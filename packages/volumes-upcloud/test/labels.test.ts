import * as fc from "fast-check"
import { assert, it } from "@effect/vitest"
import { hasClusterLabel, matchesVolumeLabels, volumeLabels } from "../src/labels.ts"

const _tag = fc.string({ minLength: 1, maxLength: 20 })
const _name = fc.string({ minLength: 1, maxLength: 20 })

it("property: a volume's own stamped labels always match itself", () => {
  fc.assert(
    fc.property(_tag, _name, (tag, name) => {
      const labels = volumeLabels({ tag, name })
      assert.isTrue(matchesVolumeLabels({ labels, tag, name }))
      assert.isTrue(hasClusterLabel({ labels, tag }))
    })
  )
})

it("property: labels stamped for one tag/name never match a different tag or name", () => {
  fc.assert(
    fc.property(_tag, _name, _tag, _name, (tag, name, otherTag, otherName) => {
      fc.pre(tag !== otherTag || name !== otherName)
      const labels = volumeLabels({ tag, name })
      assert.isFalse(matchesVolumeLabels({ labels, tag: otherTag, name: otherName }))
    })
  )
})

it("undefined labels never match", () => {
  assert.isFalse(matchesVolumeLabels({ labels: undefined, tag: "a", name: "b" }))
  assert.isFalse(hasClusterLabel({ labels: undefined, tag: "a" }))
})
