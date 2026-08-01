import type { K8sManifest, VolumeInfo, VolumeSpec } from "@kumulo/core"

const _cinderCsiDriver = "cinder.csi.openstack.org"

// kumulo: persistentVolumeReclaimPolicy: Retain — deleting the PV/PVC must never delete the backing Cinder volume.
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
    storageClassName: spec.type,
    csi: {
      driver: _cinderCsiDriver,
      volumeHandle: vol.id,
      fsType: "ext4"
    }
  }
})

export interface PvcBinding {
  readonly namespace: string
  readonly accessModes: ReadonlyArray<string>
}

export const staticPvcManifest = (
  { vol, spec, pvc }: { readonly vol: VolumeInfo; readonly spec: VolumeSpec; readonly pvc: PvcBinding }
): K8sManifest => ({
  apiVersion: "v1",
  kind: "PersistentVolumeClaim",
  metadata: { name: `${vol.name}-pvc`, namespace: pvc.namespace },
  spec: {
    accessModes: pvc.accessModes,
    storageClassName: spec.type,
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
