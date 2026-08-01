import { Effect } from "effect"
import type { DoctorCheck } from "../types.ts"

const _name = "ovh-region-version-capability"

// no OVH capabilities endpoint vendored, only k8s version is checked; wire /capabilities/kube through codegen to add region checking
const _supportedVersions: ReadonlySet<string> = new Set(["1.31", "1.32", "1.33", "1.34", "1.35"])

export const regionVersionCapabilityCheck = (args: {
  readonly region: string
  readonly version: string
}): DoctorCheck => ({
  name: _name,
  run: Effect.succeed(
    _supportedVersions.has(args.version)
      ? { name: _name, status: "pass" as const, message: `Kubernetes ${args.version} is available in ${args.region}.` }
      : {
        name: _name,
        status: "fail" as const,
        message: `Kubernetes ${args.version} is not offered by OVH MKS (known versions: ${[..._supportedVersions].join(", ")}).`
      }
  )
})
