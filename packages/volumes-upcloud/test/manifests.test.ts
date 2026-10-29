import { Schema } from "effect"
import { assert, expect, it } from "@effect/vitest"
import { staticPvcManifest, staticPvManifest, storageClassName } from "../src/manifests.ts"

const _text = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(20))

const _volumeInfo = Schema.Struct({ id: Schema.String.check(Schema.isUUID()), name: _text })

const _spec = Schema.Struct({
  name: _text,
  sizeGb: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 4096 })),
  type: Schema.Literals(["maxiops", "standard", "hdd"]),
  retain: Schema.Boolean
})

it.prop("staticPvManifest always pins the CSI driver, volumeHandle and Retain policy", [_volumeInfo, _spec], ([vol, spec]) => {
  expect(staticPvManifest({ vol, spec })).toMatchObject({
    kind: "PersistentVolume",
    spec: {
      csi: { driver: "storage.csi.upcloud.com", volumeHandle: vol.id },
      persistentVolumeReclaimPolicy: "Retain",
      accessModes: ["ReadWriteOnce"],
      storageClassName: storageClassName(spec.type),
      capacity: { storage: `${spec.sizeGb}Gi` }
    }
  })
})

it.prop(
  "staticPvcManifest always pins volumeName to the matching PV and matches its size/class",
  [_volumeInfo, _spec, _text],
  ([vol, spec, namespace]) => {
    expect(staticPvcManifest({ vol, spec, pvc: { namespace } })).toMatchObject({
      kind: "PersistentVolumeClaim",
      metadata: { name: `${vol.name}-pvc`, namespace },
      spec: {
        volumeName: `${vol.name}-pv`,
        storageClassName: storageClassName(spec.type),
        accessModes: ["ReadWriteOnce"],
        resources: { requests: { storage: `${spec.sizeGb}Gi` } }
      }
    })
  }
)

it("storageClassName follows the upcloud-block-storage-<tier> convention", () => {
  assert.strictEqual(storageClassName("maxiops"), "upcloud-block-storage-maxiops")
})
