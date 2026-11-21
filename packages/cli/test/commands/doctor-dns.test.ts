import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Effect, Layer } from "effect"
import * as BunServices from "@effect/platform-bun/BunServices"
import * as HttpClient from "effect/http/HttpClient"
import { TestConsole } from "effect/testing"
import { assert, describe, it } from "@effect/vitest"
import { Command } from "effect/cli"
import { makeStorageClient } from "@kumulo/storage-ovh"
import { makeMksClient } from "@kumulo/distro-ovh-mks"
import { makeFakeZone as makeCloudflareZone } from "../../../cloudflare/dns/test/provider/fake-zone.ts"
import { makeFakeZone as makeGodaddyZone } from "../../../godaddy/dns/test/provider/fake-zone.ts"
import { kumuloCli } from "../../src/commands.ts"
import { NameserverLookup, NameserverLookupFailed } from "../../src/doctor/dns.ts"
import { DoctorFailed } from "../../src/doctor/failed.ts"
import { MksEnv } from "../../src/mks/env.ts"
import { OpenStackEnv } from "../../src/openstack/env.ts"
import { StorageEnv } from "../../src/storage/env.ts"
import { unavailableUpcloudEnvLayer } from "../fake-upcloud-env.ts"
import { baseEncodedConfig } from "../fixtures.ts"
import { fakeCredentials } from "./fake-credentials.ts"
import { makeFakeCinder } from "./fake-cinder.ts"

process.stdout.isTTY = false

const unreachable = HttpClient.make(() => Effect.die("must not be reached"))

// the k3s fixture always fails its keystone check: no OS_* env in tests
const _distroFailure = "openstack-keystone-auth"

const _path = (module: "cloudflare" | "godaddy") => {
  const path = join(mkdtempSync(join(tmpdir(), "kumulo-doctor-dns-")), "cluster.json")
  const dns = { module, zone: "example.com", ttl: 600, records: [{ name: "*.c1", target: "203.0.113.10" }] }
  writeFileSync(path, JSON.stringify({ ...baseEncodedConfig, dns }))

  return path
}

const _ns = (answer: ReadonlyArray<string> | "fail") =>
  Layer.succeed(NameserverLookup, {
    resolveNs: (zone) =>
      answer === "fail" ? Effect.fail(new NameserverLookupFailed({ zone, reason: "ENOTFOUND" })) : Effect.succeed(answer)
  })

const _doctor = (
  { http, module, ns }: { readonly module: "cloudflare" | "godaddy"; readonly http: HttpClient.HttpClient; readonly ns: ReadonlyArray<string> | "fail" }
) =>
  Effect.gen(function*() {
    const error = yield* Command.runWith(kumuloCli, { version: "test" })(["doctor", _path(module)]).pipe(Effect.flip)
    const lines = (yield* TestConsole.logLines).map(String)

    return { error, lines }
  }).pipe(
    Effect.provide(TestConsole.layer),
    // innermost, so it wins over the HttpClient that makeFakeCinder provides
    Effect.provide(Layer.succeed(HttpClient.HttpClient, http)),
    Effect.provide(Layer.mergeAll(
      Layer.succeed(OpenStackEnv, { keystone: undefined, region: undefined, unavailableReason: "no OS_* env" }),
      Layer.succeed(MksEnv, { mks: makeMksClient(unreachable), serviceName: "" }),
      Layer.succeed(StorageEnv, { storage: makeStorageClient(unreachable), serviceName: "" }),
      makeFakeCinder({}),
      unavailableUpcloudEnvLayer,
      _ns(ns),
      fakeCredentials,
      BunServices.layer
    ))
  )

const _line = (lines: ReadonlyArray<string>, check: string): string => lines.find((line) => line.includes(` ${check}: `)) ?? ""

describe("kumulo doctor with dns.module cloudflare", () => {
  it.effect("passes both dns checks when the token sees the zone and the delegation matches its assigned nameservers", () =>
    Effect.gen(function*() {
      const zone = makeCloudflareZone({ zone: "example.com", nameServers: ["felicity.ns.cloudflare.com", "stevie.ns.cloudflare.com"] })
      const { error, lines } = yield* _doctor({ module: "cloudflare", http: zone.httpClient, ns: ["stevie.ns.cloudflare.com.", "Felicity.ns.cloudflare.com"] })

      assert.deepStrictEqual(error, new DoctorFailed({ failed: [_distroFailure] }))
      assert.include(_line(lines, "cloudflare-dns-zone-access"), "pass")
      assert.include(_line(lines, "cloudflare-dns-zone-access"), "status active")
      assert.include(_line(lines, "cloudflare-dns-delegation"), "pass")
      assert.strictEqual(zone.writes().length, 0)
    }))

  it.effect("fails the delegation check when the domain still points at another provider", () =>
    Effect.gen(function*() {
      const zone = makeCloudflareZone({ zone: "example.com", status: "pending" })
      const { error, lines } = yield* _doctor({ module: "cloudflare", http: zone.httpClient, ns: ["ns01.domaincontrol.com", "ns02.domaincontrol.com"] })

      assert.deepStrictEqual(error, new DoctorFailed({ failed: [_distroFailure, "cloudflare-dns-delegation"] }))
      const line = _line(lines, "cloudflare-dns-delegation")
      assert.include(line, "ns01.domaincontrol.com")
      assert.include(line, "felicity.ns.cloudflare.com, stevie.ns.cloudflare.com")
    }))

  it.effect("fails the access check when the token cannot see the zone, and checks delegation by suffix", () =>
    Effect.gen(function*() {
      const zone = makeCloudflareZone({ zone: "example.com", visible: false })
      const { error, lines } = yield* _doctor({ module: "cloudflare", http: zone.httpClient, ns: ["bob.ns.cloudflare.com", "lola.ns.cloudflare.com"] })

      assert.deepStrictEqual(error, new DoctorFailed({ failed: [_distroFailure, "cloudflare-dns-zone-access"] }))
      assert.include(_line(lines, "cloudflare-dns-zone-access"), "Zone:Read and DNS:Edit")
      assert.include(_line(lines, "cloudflare-dns-delegation"), "pass")
    }))

  it.effect("reports a rejected token and an unresolvable zone", () =>
    Effect.gen(function*() {
      const zone = makeCloudflareZone({ zone: "example.com", failWith: 401 })
      const { error, lines } = yield* _doctor({ module: "cloudflare", http: zone.httpClient, ns: "fail" })

      assert.deepStrictEqual(error, new DoctorFailed({ failed: [_distroFailure, "cloudflare-dns-zone-access", "cloudflare-dns-delegation"] }))
      assert.include(_line(lines, "cloudflare-dns-zone-access"), "CLOUDFLARE_API_TOKEN")
      assert.include(_line(lines, "cloudflare-dns-delegation"), "Could not resolve")
    }))
})

describe("kumulo doctor with dns.module godaddy", () => {
  it.effect("catches a zone delegated to Cloudflare while kumulo writes at GoDaddy", () =>
    Effect.gen(function*() {
      const zone = makeGodaddyZone({ zone: "example.com" })
      const { error, lines } = yield* _doctor({ module: "godaddy", http: zone.httpClient, ns: ["felicity.ns.cloudflare.com", "stevie.ns.cloudflare.com"] })

      assert.deepStrictEqual(error, new DoctorFailed({ failed: [_distroFailure, "godaddy-dns-delegation"] }))
      assert.include(_line(lines, "godaddy-dns-zone-access"), "pass")
      assert.include(_line(lines, "godaddy-dns-delegation"), "not to GoDaddy (*.domaincontrol.com)")
    }))

  it.effect("passes when the zone uses GoDaddy's nameservers", () =>
    Effect.gen(function*() {
      const zone = makeGodaddyZone({ zone: "example.com" })
      const { error, lines } = yield* _doctor({ module: "godaddy", http: zone.httpClient, ns: ["ns51.domaincontrol.com", "ns52.domaincontrol.com"] })

      assert.deepStrictEqual(error, new DoctorFailed({ failed: [_distroFailure] }))
      assert.include(_line(lines, "godaddy-dns-delegation"), "pass")
    }))
})
