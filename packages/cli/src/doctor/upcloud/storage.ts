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

export const upcloudStorageReachCheck = (storage: StorageClient): DoctorCheck =>
  _reach({ name: "upcloud-storage-reachable", run: storage.list() })

export const upcloudObjectStorageReachCheck = (objectStorage: ObjectStorageClient): DoctorCheck =>
  _reach({ name: "upcloud-object-storage-reachable", run: objectStorage.services.list() })

const _regionName = "upcloud-object-storage-region-exists"

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

export const csiDevicePermissionCheck: DoctorCheck = {
  name: csiDevicePermissionNote.name,
  run: Effect.succeed({ name: csiDevicePermissionNote.name, status: "pass", message: csiDevicePermissionNote.message })
}
