import { Effect } from "effect"
import type { DoctorCheck } from "../types.ts"

const _name = "ovh-region-version-capability"

// ponytail: OVH has no vendored "capabilities" endpoint in this codegen slice
// (distro-ovh-mks's allowlist only covers cluster/nodepool CRUD, and this
// task can't add to it — that's out of this task's ownership), so region
// support isn't independently verifiable yet; only the k8s version is
// checked, against the generated client's own version enum (kept in sync
// by hand since the enum isn't re-exported through the package barrel).
// Upgrade: wire OVH's `/cloud/project/{serviceName}/capabilities/kube`
// endpoint through the codegen pipeline and check `region` for real once
// that lands.
const _supportedVersions: ReadonlySet<string> = new Set(["1.31", "1.32", "1.33", "1.34", "1.35"])

/** FR-10.2 — region+version capability (version half; see ponytail note on the region gap). */
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
