import { describe, expect, it } from "@effect/vitest"
import { staticPvcManifest, staticPvManifest, staticVolumeManifests } from "../../src/volume/manifests.ts"

const vol = { id: "1", name: "postgres-data" }
const spec = { name: "postgres-data", sizeGb: 100, type: "hcloud-volumes", retain: true }

describe("staticPvManifest", () => {
  it("pins csi.volumeHandle to the hcloud volume id and Retain policy", () => {
    expect(staticPvManifest({ vol, spec })).toMatchObject({
      kind: "PersistentVolume",
      spec: {
        persistentVolumeReclaimPolicy: "Retain",
        csi: { driver: "csi.hetzner.cloud", volumeHandle: "1" }
      }
    })
  })
})

describe("staticPvcManifest", () => {
  it("binds to the generated PV by name", () => {
    expect(staticPvcManifest({ vol, spec, pvc: { namespace: "db", accessModes: ["ReadWriteOnce"] } })).toMatchObject({
      kind: "PersistentVolumeClaim",
      metadata: { namespace: "db" },
      spec: { volumeName: "postgres-data-pv" }
    })
  })
})

describe("staticVolumeManifests", () => {
  it("returns just the PV when no pvc binding is given", () => {
    expect(staticVolumeManifests({ vol, spec })).toHaveLength(1)
  })

  it("returns PV + PVC when a pvc binding is given", () => {
    expect(staticVolumeManifests({ vol, spec, pvc: { namespace: "db", accessModes: ["ReadWriteOnce"] } })).toHaveLength(2)
  })
})
