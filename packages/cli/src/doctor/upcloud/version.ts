import { Effect } from "effect"
import type { DoctorCheck } from "../types.ts"
import { SUPPORTED_KUBERNETES_VERSIONS } from "../kubernetes-versions.ts"

const _name = "upcloud-version-supported"

/** Requested Kubernetes version supported (see the note on the missing live endpoint). */
export const versionSupportedCheck = (args: { readonly version: string }): DoctorCheck => ({
  name: _name,
  run: Effect.succeed(
    SUPPORTED_KUBERNETES_VERSIONS.has(args.version)
      ? { name: _name, status: "pass" as const, message: `Kubernetes ${args.version} is available on UpCloud UKS.` }
      : {
        name: _name,
        status: "fail" as const,
        message: `Kubernetes ${args.version} is not a known UKS version (known: ${[...SUPPORTED_KUBERNETES_VERSIONS].join(", ")}).`
      }
  )
})
