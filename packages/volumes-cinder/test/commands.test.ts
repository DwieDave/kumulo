import { describe, expect, it } from "@effect/vitest"
import { adoptVolume, listVolumes } from "../src/commands.ts"
import { emptyOutputs } from "../src/outputs.ts"

describe("listVolumes", () => {
  it("projects the outputs file's volumes", () => {
    const file = { cluster: "prod", volumes: [{ name: "a", id: "1", retain: true }] }
    expect(listVolumes(file)).toEqual(file.volumes)
  })
})

describe("adoptVolume", () => {
  it("records the adopted volume id and regenerates its PV manifest", () => {
    const spec = { name: "postgres-data", sizeGb: 100, type: "high-speed", retain: true }
    const { outputs, manifests } = adoptVolume({ file: emptyOutputs("staging"), volumeId: "vol-1", spec })
    expect(outputs.volumes).toEqual([{ name: "postgres-data", id: "vol-1", retain: true }])
    expect(manifests).toHaveLength(1)
    expect(manifests[0]).toMatchObject({ spec: { csi: { volumeHandle: "vol-1" } } })
  })

  it("includes a PVC manifest when a pvc binding is given", () => {
    const spec = { name: "postgres-data", sizeGb: 100, type: "high-speed", retain: true }
    const { manifests } = adoptVolume({
      file: emptyOutputs("staging"),
      volumeId: "vol-1",
      spec,
      pvc: { namespace: "db", accessModes: ["ReadWriteOnce"] }
    })
    expect(manifests).toHaveLength(2)
  })
})
