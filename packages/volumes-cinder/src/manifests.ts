import type { K8sManifest, VolumeInfo, VolumeSpec } from "@kumulo/core"

// kumulo: matches OVH-provisioned + self-installed cinder-csi — same
// driver name, same volumeHandle semantics under both distros.
const _cinderCsiDriver = "cinder.csi.openstack.org"

// kumulo: VolumeProvider port method: pins `csi.volumeHandle` to the
// stable Cinder volume ID, `persistentVolumeReclaimPolicy: Retain` so
// deleting the PV/PVC never deletes the backing volume.
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

// kumulo: PVC binding needs namespace/accessModes from the cluster config's
// `volumes.retained[].pvc` block, which isn't part of the frozen
// `VolumeProvider.staticPvManifest(vol, spec)` port signature — exposed as
// a separate pure function for the CLI/core orchestrator to call
// alongside `staticPvManifest`, not as part of the port itself.
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
