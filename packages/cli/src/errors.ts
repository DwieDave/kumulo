import { SchemaIssue } from "effect"
import type { PlatformError } from "effect/PlatformError"
import { HttpClientError } from "effect/unstable/http"

const _formatIssue = SchemaIssue.makeFormatterDefault()
import type { KumuloError, RendererRegistry } from "@kumulo/core"
import { renderError } from "@kumulo/core"
import type { OutputsInvalid as StorageOutputsInvalid } from "@kumulo/storage-ovh"
import type { OutputsInvalid as VolumesOutputsInvalid } from "@kumulo/volumes-cinder"
import type { DistroNotWired } from "./distro-not-wired.ts"

/**
 * The one formatting convention for every multi-part error: a title line,
 * then each detail indented two spaces (details may themselves be
 * multi-line). No details → just the title.
 */
const _block = (
  { details, title }: { readonly title: string; readonly details: ReadonlyArray<string> }
): string =>
  details.length === 0
    ? title
    : [`${title}:`, ...details.flatMap((detail) => detail.split("\n")).map((line) => `  ${line}`)].join("\n")

/**
 * Prettify a raw message: unwrap provider JSON bodies (`{"message": "..."}`),
 * strip `[Tag] 400:` prefixes, and put a trailing `(request ID: x)` on its
 * own line.
 */
const _messageDetails = (text: string): ReadonlyArray<string> => {
  if (text === "") return []
  let message = text
  try {
    const parsed: unknown = JSON.parse(text)
    if (typeof parsed === "object" && parsed !== null && "message" in parsed && typeof parsed.message === "string") {
      message = parsed.message
    }
  } catch {
    // not JSON — show as-is
  }
  const match = message.match(/^(.*?)\s*\(request ID: ([^)]+)\)\s*$/s)
  const body = (match?.[1] ?? message).replace(/^\[\w+\] \d+: /, "")
  const requestId = match?.[2]
  return requestId === undefined ? [body] : [body, `request ID: ${requestId}`]
}

/** Detail lines for an unknown cause — HTTP errors get request/status lines, everything else its message. */
const _causeDetails = (cause: unknown): ReadonlyArray<string> => {
  if (HttpClientError.isHttpClientError(cause)) {
    const status = cause.response?.status
    const description = "description" in cause.reason && typeof cause.reason.description === "string"
      ? cause.reason.description
      : ""
    return [
      `${cause.request.method} ${cause.request.url}${status === undefined ? "" : ` → ${status}`}`,
      ..._messageDetails(description)
    ]
  }
  if (cause instanceof Error) return _messageDetails(cause.message)
  return _messageDetails(String(cause))
}

/**
 * Full renderer registry — `RendererRegistry`'s mapped type requires every
 * tag in `KumuloErrorTag`, not just the ones the ovh-mks path can currently
 * raise, so unreached tags get a plain generic message rather than being
 * left unimplemented.
 */
export const cliErrorRegistry: RendererRegistry = {
  HttpTransportError: (error) => _block({ title: "Provider API request failed", details: _causeDetails(error.cause) }),
  ResponseDecodeError: (error) =>
    _block({
      title: `Unexpected response shape from ${error.endpoint}`,
      details: [_formatIssue(error.issue)]
    }),
  AuthenticationFailed: (error) => `Authentication failed: ${error.hint}`,
  QuotaExceeded: (error) =>
    `Quota exceeded for ${error.resource}: requested ${error.requested ?? "unknown"}, limit ${error.limit ?? "unknown"}`,
  RateLimited: (error) =>
    `Rate limited by the provider on ${error.kind} ${error.ref}${error.retryAfter === undefined ? "" : ` — retry after ${error.retryAfter}`}`,
  ProviderApiError: (error) =>
    `Provider API error during ${error.operation} (HTTP ${error.status})${error.body === "" ? "" : `: ${error.body}`}`,
  ResourceNotFound: (error) => `${error.kind} not found: ${error.ref}`,
  ResourceConflict: (error) => `${error.kind} conflict: ${error.ref}`,
  CapabilityMissing: (error) =>
    `${error.capability} is not available in ${error.region}${error.workaround ? ` (${error.workaround})` : ""}`,
  ProvisioningTimeout: (error) => `Timed out waiting for ${error.kind} ${error.ref} (last status: ${error.lastStatus})`,
  ConfigInvalid: (error) =>
    _block({
      title: "Config is invalid",
      details: error.issues.map((issue) => `- ${issue.path.join(".") || "(root)"}: ${issue.message}`)
    }),
  PlanRejected: (error) => `Plan rejected: ${error.reason}`,
  BootstrapFailed: (error) => _block({ title: `Bootstrap failed on ${error.node} during ${error.phase}`, details: [error.log] }),
  AddonInstallFailed: (error) => _block({ title: `Failed to install addon ${error.addon}`, details: _messageDetails(error.cause) }),
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
