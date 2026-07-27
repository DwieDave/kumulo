import { Option, SchemaIssue } from "effect"
import { BadArgument, PlatformError } from "effect/PlatformError"
import { assert, it } from "@effect/vitest"
import {
  AddonInstallFailed,
  AuthenticationFailed,
  BootstrapFailed,
  BucketNotEmpty,
  CapabilityMissing,
  ConfigInvalid,
  HttpTransportError,
  PlanRejected,
  ProvisioningTimeout,
  ProviderApiError,
  QuotaExceeded,
  RateLimited,
  ResourceConflict,
  ResourceNotFound,
  ResponseDecodeError,
  SinkUnavailable
} from "@kumulo/core"
import type { KumuloError, KumuloErrorTag } from "@kumulo/core"
import { OutputsInvalid } from "@kumulo/volumes-cinder"
import { DistroNotWired } from "../src/distro-not-wired.ts"
import type { CliExitError } from "../src/exit-codes.ts"
import { exitCodeFor } from "../src/exit-codes.ts"

// The point of per-family exit codes is that CI can branch on the failure
// kind without parsing messages. Two distinct error classes collapsing onto
// one code (a copy-paste in `_codeByTag`, or a new tag silently falling
// through to the `_defaultCode` of 1) destroys exactly that property, and
// nothing else in the suite would notice.

// `Record<KumuloErrorTag, ...>` — adding a tag to `KumuloError` fails to
// compile here until it is represented, same convention as `cliErrorRegistry`.
const _samples: Record<KumuloErrorTag, KumuloError> = {
  HttpTransportError: new HttpTransportError({ cause: "ECONNRESET" }),
  ResponseDecodeError: new ResponseDecodeError({
    endpoint: "/flavors",
    issue: new SchemaIssue.InvalidValue(Option.none(), { message: "missing field" })
  }),
  AuthenticationFailed: new AuthenticationFailed({ hint: "bad token" }),
  QuotaExceeded: new QuotaExceeded({ resource: "instances", limit: 1, requested: 2 }),
  ResourceNotFound: new ResourceNotFound({ kind: "kube", ref: "prod-eu" }),
  ResourceConflict: new ResourceConflict({ kind: "kube", ref: "prod-eu" }),
  CapabilityMissing: new CapabilityMissing({ capability: "octavia", region: "GRA11" }),
  ProvisioningTimeout: new ProvisioningTimeout({ kind: "node", ref: "n-0", lastStatus: "BUILD" }),
  ConfigInvalid: new ConfigInvalid({ issues: [{ path: ["name"], message: "required" }] }),
  PlanRejected: new PlanRejected({ reason: "declined" }),
  BootstrapFailed: new BootstrapFailed({ node: "n-0", phase: "install", log: "" }),
  AddonInstallFailed: new AddonInstallFailed({ addon: "ccm", cause: "timeout" }),
  BucketNotEmpty: new BucketNotEmpty({ bucket: "b", objectCount: 3 }),
  RateLimited: new RateLimited({ kind: "server", ref: "v2.1/servers", retryAfter: "30" }),
  ProviderApiError: new ProviderApiError({ operation: "server v2.1/servers", status: 503, body: "boom" }),
  SinkUnavailable: new SinkUnavailable({ hint: "no sops" })
}

const _allErrors: ReadonlyArray<CliExitError> = [
  ...Object.values(_samples),
  new DistroNotWired({ distro: "k3s" }),
  new OutputsInvalid({ message: "bad json" }),
  new PlatformError(new BadArgument({ module: "FileSystem", method: "readFileString" }))
]

it("maps every error class to its own exit code", () => {
  const codes = _allErrors.map(exitCodeFor)
  assert.strictEqual(new Set(codes).size, codes.length, `exit codes collide: ${JSON.stringify(codes)}`)
})

it("never reports a failure as success, nor falls back to the generic code", () => {
  for (const error of _allErrors) {
    const code = exitCodeFor(error)
    assert.notStrictEqual(code, 0, `${error._tag} exits 0`)
    // 1 is the escape hatch for defects only — a known tag reaching it means
    // it is missing from `_codeByTag`.
    assert.notStrictEqual(code, 1, `${error._tag} has no dedicated exit code`)
  }
})
