import { Effect } from "effect"
import type { ZoneClient } from "@kumulo/upcloud"
import type { DoctorCheck } from "../types.ts"

const _name = "upcloud-zone-exists"

export const zoneExistsCheck = (
  { zone, zones }: { readonly zone: string; readonly zones: ZoneClient }
): DoctorCheck => ({
  name: _name,
  run: zones.list().pipe(
    Effect.map((known) => {
      const usable = known.filter((entry) => entry.public !== "no").map((entry) => entry.id)
      return usable.includes(zone)
        ? { name: _name, status: "pass" as const, message: `Zone "${zone}" exists.` }
        : {
          name: _name,
          status: "fail" as const,
          message: `Zone "${zone}" is not one of UpCloud's zones (${usable.join(", ")}).`
        }
    }),
    Effect.catch(() =>
      Effect.succeed({
        name: _name,
        status: "fail" as const,
        message: `Could not list UpCloud zones to verify "${zone}" — the zone may be fine; check the API token first.`
      })
    )
  )
})
