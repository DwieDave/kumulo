import type { K8sManifest, VolumeInfo, VolumeSpec } from "@kumulo/core"

// kumulo: matches hcloud-csi's provisioner name (R10) — same driver both this
// static-PV path and the self-installed `hcloud-csi` addon reference.
const _hcloudCsiDriver = "csi.hetzner.cloud"

// kumulo: VolumeProvider port method — pins `csi.volumeHandle` to the stable
// hcloud volume ID, `persistentVolumeReclaimPolicy: Retain` so deleting the
// PV/PVC never deletes the backing volume (mirrors `@kumulo/volumes-cinder`'s
// `staticPvManifest`, duplicated not imported per dependency-cruiser's
// `no-sibling-package-imports`).
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
      driver: _hcloudCsiDriver,
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
// `volumes.managed[].pvc` block, not part of the frozen
// `VolumeProvider.staticPvManifest(vol, spec)` port signature — exposed
// separately for the CLI orchestrator to call alongside it.
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
