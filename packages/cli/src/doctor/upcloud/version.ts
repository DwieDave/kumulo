import { Effect } from "effect"
import type { DoctorCheck } from "../types.ts"

const _name = "upcloud-version-supported"

// no vendored "supported UKS versions" endpoint (same gap as OVH's
// `regionVersionCapabilityCheck`) — hand-kept list, minor-only (UKS is
// minor-only per D7). Upgrade: wire a live capability read once vendored.
const _supportedVersions: ReadonlySet<string> = new Set(["1.31", "1.32", "1.33", "1.34", "1.35"])

/** Requested Kubernetes version supported (see the note on the missing live endpoint). */
export const versionSupportedCheck = (args: { readonly version: string }): DoctorCheck => ({
  name: _name,
  run: Effect.succeed(
    _supportedVersions.has(args.version)
      ? { name: _name, status: "pass" as const, message: `Kubernetes ${args.version} is available on UpCloud UKS.` }
      : {
        name: _name,
        status: "fail" as const,
        message: `Kubernetes ${args.version} is not a known UKS version (known: ${[..._supportedVersions].join(", ")}).`
      }
  )
})
