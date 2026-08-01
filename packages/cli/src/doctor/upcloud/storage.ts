/**
 * T6.3/R15: doctor checks for the `volumes.module: "upcloud"` /
 * `object_storage.module: "upcloud"` paths — token reach on `/1.3/storage`
 * and `/object-storage-2`, the configured object-storage region, and the
 * CSI device-permission manual note (R7/Q1) surfaced from `@kumulo/volumes-upcloud`.
 */
import { Effect } from "effect"
import type { ObjectStorageClient, StorageClient } from "@kumulo/upcloud"
import { csiDevicePermissionNote } from "@kumulo/volumes-upcloud"
import type { DoctorCheck, DoctorCheckResult } from "../types.ts"

const _reach = (
  { name, run }: { readonly name: string; readonly run: Effect.Effect<unknown, unknown> }
): DoctorCheck => ({
  name,
  run: run.pipe(
    Effect.match({
      onSuccess: (): DoctorCheckResult => ({ name, status: "pass", message: `UpCloud API token reaches this endpoint.` }),
      onFailure: (): DoctorCheckResult => ({
        name,
        status: "fail",
        message: `Could not reach this endpoint — check UPCLOUD_API_TOKEN and its permissions.`
      })
    })
  )
})

/** R15: token reaches `/1.3/storage` — only meaningful when `volumes.module: "upcloud"`. */
export const upcloudStorageReachCheck = (storage: StorageClient): DoctorCheck =>
  _reach({ name: "upcloud-storage-reachable", run: storage.list() })

/** R15: token reaches `/object-storage-2` — only meaningful when `object_storage.module: "upcloud"`. */
export const upcloudObjectStorageReachCheck = (objectStorage: ObjectStorageClient): DoctorCheck =>
  _reach({ name: "upcloud-object-storage-reachable", run: objectStorage.services.list() })

const _regionName = "upcloud-object-storage-region-exists"

/** R15/D8: the configured `object_storage.region` is validated live, never against a hand-kept list (mirrors `zoneExistsCheck`). */
export const objectStorageRegionCheck = (
  { objectStorage, region }: { readonly objectStorage: ObjectStorageClient; readonly region: string }
): DoctorCheck => ({
  name: _regionName,
  run: objectStorage.regions().pipe(
    Effect.map((regions): DoctorCheckResult => {
      const names = regions.map((r) => r.name)
      return names.includes(region)
        ? { name: _regionName, status: "pass", message: `Region "${region}" exists.` }
        : { name: _regionName, status: "fail", message: `Region "${region}" is not one of UpCloud's object-storage regions (${names.join(", ")}).` }
    }),
    Effect.catch(() =>
      Effect.succeed({
        name: _regionName,
        status: "fail" as const,
        message: `Could not list UpCloud object-storage regions to verify "${region}" — check the API token first.`
      })
    )
  )
})

/** R7/Q1: the CSI device-permission manual note, wrapped as an always-`pass` `DoctorCheck` (a note is informational, not a diagnosis). */
export const csiDevicePermissionCheck: DoctorCheck = {
  name: csiDevicePermissionNote.name,
  run: Effect.succeed({ name: csiDevicePermissionNote.name, status: "pass", message: csiDevicePermissionNote.message })
}
