import * as fc from "fast-check"
import { assert, expect, it } from "@effect/vitest"
import { staticPvcManifest, staticPvManifest, storageClassName } from "../src/manifests.ts"

const _volumeInfo = fc.record({ id: fc.uuid(), name: fc.string({ minLength: 1, maxLength: 20 }) })
const _spec = fc.record({
  name: fc.string({ minLength: 1, maxLength: 20 }),
  sizeGb: fc.integer({ min: 1, max: 4096 }),
  type: fc.constantFrom("maxiops", "standard", "hdd"),
  retain: fc.boolean()
})

it("property: staticPvManifest always pins the CSI driver, volumeHandle and Retain policy", () => {
  fc.assert(
    fc.property(_volumeInfo, _spec, (vol, spec) => {
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
  )
})

it("property: staticPvcManifest always pins volumeName to the matching PV and matches its size/class", () => {
  fc.assert(
    fc.property(_volumeInfo, _spec, fc.string({ minLength: 1, maxLength: 20 }), (vol, spec, namespace) => {
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
    })
  )
})

it("storageClassName follows the upcloud-block-storage-<tier> convention", () => {
  assert.strictEqual(storageClassName("maxiops"), "upcloud-block-storage-maxiops")
})
