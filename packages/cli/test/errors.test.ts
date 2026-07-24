import { Option, SchemaIssue } from "effect"
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
  QuotaExceeded,
  ResourceConflict,
  ResourceNotFound,
  ResponseDecodeError,
  SinkUnavailable
} from "@kumulo/core"
import { DistroNotWired } from "../src/distro-not-wired.ts"
import { renderCliError } from "../src/errors.ts"

// Every `KumuloError` tag has a renderer (compile-enforced by
// `RendererRegistry`'s mapped type) and at least one test asserting its
// message here.

it("renders a core KumuloError via the shared registry", () => {
  const message = renderCliError(new AuthenticationFailed({ hint: "bad token" }))
  assert.match(message, /Authentication failed: bad token/)
})

it("renders ResourceNotFound", () => {
  const message = renderCliError(new ResourceNotFound({ kind: "kube", ref: "prod-eu" }))
  assert.match(message, /kube not found: prod-eu/)
})

it("renders HttpTransportError", () => {
  const message = renderCliError(new HttpTransportError({ cause: "ECONNRESET" }))
  assert.match(message, /Network error.*ECONNRESET/)
})

it("renders ResponseDecodeError", () => {
  const issue = new SchemaIssue.InvalidValue(Option.none(), { message: "missing field" })
  const message = renderCliError(new ResponseDecodeError({ endpoint: "/v3/tokens", issue }))
  assert.match(message, /\/v3\/tokens/)
})

it("renders QuotaExceeded", () => {
  const message = renderCliError(new QuotaExceeded({ resource: "instances", requested: 5, limit: 3 }))
  assert.match(message, /Quota exceeded for instances: requested 5, limit 3/)
})

it("renders ResourceConflict", () => {
  const message = renderCliError(new ResourceConflict({ kind: "dns-record", ref: "api.example.com" }))
  assert.match(message, /dns-record conflict: api.example.com/)
})

it("renders CapabilityMissing", () => {
  const message = renderCliError(new CapabilityMissing({ capability: "octavia", region: "GRA" }))
  assert.match(message, /octavia is not available in GRA/)
})

it("renders ProvisioningTimeout", () => {
  const message = renderCliError(new ProvisioningTimeout({ kind: "server", ref: "node-1", lastStatus: "BUILD" }))
  assert.match(message, /Timed out waiting for server node-1.*BUILD/)
})

it("renders ConfigInvalid", () => {
  const message = renderCliError(new ConfigInvalid({ issues: [{ path: ["masters", "count"], message: "must be odd" }] }))
  assert.match(message, /masters\.count: must be odd/)
})

it("renders PlanRejected", () => {
  const message = renderCliError(new PlanRejected({ reason: "flavor change needs confirmation" }))
  assert.match(message, /Plan rejected: flavor change needs confirmation/)
})

it("renders BootstrapFailed", () => {
  const message = renderCliError(new BootstrapFailed({ node: "master-1", phase: "install", log: "exit 1" }))
  assert.match(message, /Bootstrap failed on master-1 during install/)
})

it("renders AddonInstallFailed", () => {
  const message = renderCliError(new AddonInstallFailed({ addon: "cilium", cause: "timeout" }))
  assert.match(message, /Failed to install addon cilium: timeout/)
})

it("renders BucketNotEmpty", () => {
  const message = renderCliError(new BucketNotEmpty({ bucket: "staging-eu-backups", objectCount: 3 }))
  assert.match(message, /staging-eu-backups.*3 object/)
})

it("renders SinkUnavailable", () => {
  const message = renderCliError(new SinkUnavailable({ hint: "sops binary not found" }))
  assert.match(message, /Credentials sink unavailable: sops binary not found/)
})

it("renders a CLI-only DistroNotWired error", () => {
  const message = renderCliError(new DistroNotWired({ distro: "k3s" }))
  assert.match(message, /k3s.*not wired/)
})
