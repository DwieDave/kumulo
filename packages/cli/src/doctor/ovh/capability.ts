import { Effect } from "effect"
import type { DoctorCheck } from "../types.ts"
import { SUPPORTED_KUBERNETES_VERSIONS } from "../kubernetes-versions.ts"

const _name = "ovh-region-version-capability"

export const regionVersionCapabilityCheck = (args: {
  readonly region: string
  readonly version: string
}): DoctorCheck => ({
  name: _name,
  run: Effect.succeed(
    SUPPORTED_KUBERNETES_VERSIONS.has(args.version)
      ? { name: _name, status: "pass" as const, message: `Kubernetes ${args.version} is available in ${args.region}.` }
      : {
        name: _name,
        status: "fail" as const,
        message: `Kubernetes ${args.version} is not offered by OVH MKS (known versions: ${[...SUPPORTED_KUBERNETES_VERSIONS].join(", ")}).`
      }
  )
})
