import type { K8sManifest, VolumeInfo, VolumeSpec } from "@kumulo/core"

// kumulo: UpCloud's block-storage CSI driver name, per R5.
const _upcloudCsiDriver = "storage.csi.upcloud.com"

/** R5: tier's preinstalled StorageClass name — `type` is the tier (D5), immutable at the API. */
export const storageClassName = (tier: string): string => `upcloud-block-storage-${tier}`

// kumulo: VolumeProvider port method: pins `csi.volumeHandle` to the stable
// storage UUID, `persistentVolumeReclaimPolicy: Retain` so deleting the
// PV/PVC never deletes the backing storage.
export const staticPvManifest = (
  { vol, spec }: { readonly vol: VolumeInfo; readonly spec: VolumeSpec }
): K8sManifest => ({
  apiVersion: "v1",
  kind: "PersistentVolume",
  metadata: { name: `${vol.name}-pv` },
  spec: {
    capacity: { storage: `${spec.sizeGb}Gi` },
    accessModes: ["ReadWriteOnce"],
    persistentVolumeReclaimPolicy: "Retain",
    storageClassName: storageClassName(spec.type),
    csi: {
      driver: _upcloudCsiDriver,
      volumeHandle: vol.id,
      fsType: "ext4"
    }
  }
})

export interface PvcBinding {
  readonly namespace: string
}

// kumulo: R5's PVC half — pinned to the PV by name, matching storageClassName/
// access modes/size so the binder has nothing left to choose.
export const staticPvcManifest = (
  { vol, spec, pvc }: { readonly vol: VolumeInfo; readonly spec: VolumeSpec; readonly pvc: PvcBinding }
): K8sManifest => ({
  apiVersion: "v1",
  kind: "PersistentVolumeClaim",
  metadata: { name: `${vol.name}-pvc`, namespace: pvc.namespace },
  spec: {
    accessModes: ["ReadWriteOnce"],
    storageClassName: storageClassName(spec.type),
    resources: { requests: { storage: `${spec.sizeGb}Gi` } },
    volumeName: `${vol.name}-pv`
  }
})

export const staticVolumeManifests = (
  { vol, spec, pvc }: { readonly vol: VolumeInfo; readonly spec: VolumeSpec; readonly pvc?: PvcBinding }
): ReadonlyArray<K8sManifest> =>
  pvc === undefined
    ? [staticPvManifest({ vol, spec })]
    : [staticPvManifest({ vol, spec }), staticPvcManifest({ vol, spec, pvc })]
