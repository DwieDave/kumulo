import type { PlatformError } from "effect/PlatformError"
import type { KumuloError, RendererRegistry } from "@kumulo/core"
import { renderError } from "@kumulo/core"
import type { OutputsInvalid as StorageOutputsInvalid } from "@kumulo/storage-ovh"
import type { OutputsInvalid as VolumesOutputsInvalid } from "@kumulo/volumes-cinder"
import type { DistroNotWired } from "./distro-not-wired.ts"

/**
 * Full renderer registry — `RendererRegistry`'s mapped type requires every
 * tag in `KumuloErrorTag`, not just the ones the ovh-mks path can currently
 * raise, so unreached tags get a plain generic message rather than being
 * left unimplemented.
 */
export const cliErrorRegistry: RendererRegistry = {
  HttpTransportError: (error) => `Network error talking to the provider API: ${String(error.cause)}`,
  ResponseDecodeError: (error) => `Unexpected response shape from ${error.endpoint}: ${String(error.issue)}`,
  AuthenticationFailed: (error) => `Authentication failed: ${error.hint}`,
  QuotaExceeded: (error) => `Quota exceeded for ${error.resource}: requested ${error.requested}, limit ${error.limit}`,
  ResourceNotFound: (error) => `${error.kind} not found: ${error.ref}`,
  ResourceConflict: (error) => `${error.kind} conflict: ${error.ref}`,
  CapabilityMissing: (error) =>
    `${error.capability} is not available in ${error.region}${error.workaround ? ` (${error.workaround})` : ""}`,
  ProvisioningTimeout: (error) => `Timed out waiting for ${error.kind} ${error.ref} (last status: ${error.lastStatus})`,
  ConfigInvalid: (error) =>
    ["Config is invalid:", ...error.issues.map((issue) => `  - ${issue.path.join(".") || "(root)"}: ${issue.message}`)]
      .join("\n"),
  PlanRejected: (error) => `Plan rejected: ${error.reason}`,
  BootstrapFailed: (error) => `Bootstrap failed on ${error.node} during ${error.phase}:\n${error.log}`,
  AddonInstallFailed: (error) => `Failed to install addon ${error.addon}: ${error.cause}`,
  BucketNotEmpty: (error) => `Bucket ${error.bucket} still has ${error.objectCount} object(s); refusing to delete`,
  SinkUnavailable: (error) => `Credentials sink unavailable: ${error.hint}`
}

export type CliDomainError = KumuloError | DistroNotWired | VolumesOutputsInvalid | StorageOutputsInvalid | PlatformError

/**
 * `_tag ===` checks narrow the union without a cast: once `PlatformError`,
 * `DistroNotWired` and `OutputsInvalid` (shared tag, volumes and storage both
 * carry the same `{ message }` shape) are ruled out, TypeScript narrows
 * `error` to `KumuloError` for the final `renderError` call.
 */
export const renderCliError = (error: CliDomainError): string => {
  if (error._tag === "PlatformError") return `File error: ${error.message}`
  if (error._tag === "DistroNotWired") return `distro "${error.distro}" is not wired into the CLI yet`
  if (error._tag === "OutputsInvalid") return `Outputs file is invalid: ${error.message}`
  return renderError({ registry: cliErrorRegistry, error })
}
