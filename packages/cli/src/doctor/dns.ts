import { Resolver } from "node:dns/promises"
import { Context, Data, Effect, Option, Result } from "effect"
import * as HttpClient from "effect/http/HttpClient"
import { makeCloudflareDnsClient } from "@kumulo/dns-cloudflare"
import type { CloudflareZone } from "@kumulo/dns-cloudflare"
import { makeGodaddyDnsClient } from "@kumulo/dns-godaddy"
import type { ClusterConfig } from "../cluster-config.ts"
import { cloudflareHttpClientFromEnv, godaddyHttpClientFromEnv } from "../dns/registry.ts"
import { renderCliError } from "../errors.ts"
import type { DoctorCheck, DoctorCheckResult } from "./types.ts"

export class NameserverLookupFailed extends Data.TaggedError("NameserverLookupFailed")<{
  readonly zone: string
  readonly reason: string
}> {}

export interface NameserverLookupService {
  readonly resolveNs: (zone: string) => Effect.Effect<ReadonlyArray<string>, NameserverLookupFailed>
}

// The NS set a recursive resolver returns follows the delegation at the parent zone, so it shows
// which provider actually serves the zone. Tests replace this reference with a fixed answer.
export const NameserverLookup = Context.Reference<NameserverLookupService>("@kumulo/cli/doctor/NameserverLookup", {
  defaultValue: () => ({
    resolveNs: (zone) =>
      Effect.tryPromise({
        try: () => new Resolver({ timeout: 5000, tries: 2 }).resolveNs(zone),
        catch: (cause) => new NameserverLookupFailed({ zone, reason: String(cause) })
      })
  })
})

const _bare = (host: string): string => host.toLowerCase().replace(/\.$/, "")

const _pass = (name: string, message: string): DoctorCheckResult => ({ name, status: "pass", message })

const _fail = (name: string, message: string): DoctorCheckResult => ({ name, status: "fail", message })

interface Delegation {
  readonly provider: string
  // the nameservers the zone must use, when the provider tells us
  readonly assigned: ReadonlyArray<string> | undefined
  // what any of the provider's nameservers looks like, when it does not
  readonly suffix: string
}

const _delegationCheck = (
  { delegation, name, zone }: { readonly name: string; readonly zone: string; readonly delegation: Effect.Effect<Delegation> }
): DoctorCheck => ({
  name,
  run: Effect.gen(function*() {
    const expected = yield* delegation
    const lookup = yield* NameserverLookup
    const found = yield* lookup.resolveNs(zone).pipe(Effect.map((hosts) => hosts.map(_bare).toSorted()), Effect.option)

    if (Option.isNone(found)) return _fail(name, `Could not resolve the NS records of "${zone}" to check where it is delegated.`)

    const actual = found.value
    const assigned = expected.assigned?.map(_bare).toSorted()

    const ok = assigned === undefined
      ? actual.some((host) => host.endsWith(expected.suffix))
      : actual.length === assigned.length && actual.every((host, i) => host === assigned[i])

    const wanted = assigned === undefined ? `*${expected.suffix}` : assigned.join(", ")

    return ok
      ? _pass(name, `"${zone}" is delegated to ${expected.provider} (${actual.join(", ")}).`)
      : _fail(
        name,
        `"${zone}" is delegated to ${actual.join(", ") || "no nameservers"}, not to ${expected.provider} (${wanted}). Records kumulo writes at ${expected.provider} are not served: change the domain's nameservers at its registrar, or set dns.module to the provider that serves the zone.`
      )
  })
})

const _cloudflareChecks = (
  { http, zone }: { readonly zone: string; readonly http: HttpClient.HttpClient }
): Effect.Effect<ReadonlyArray<DoctorCheck>> =>
  Effect.gen(function*() {
    const found = yield* Effect.cached(
      cloudflareHttpClientFromEnv().pipe(
        Effect.flatMap((client) => makeCloudflareDnsClient(client).findZone({ name: zone })),
        Effect.provideService(HttpClient.HttpClient, http),
        Effect.result
      )
    )

    const access = "cloudflare-dns-zone-access"

    const accessCheck: DoctorCheck = {
      name: access,
      run: Effect.map(found, (result) => {
        if (Result.isFailure(result)) return _fail(access, renderCliError(result.failure))

        return Option.match(result.success, {
          onNone: () =>
            _fail(
              access,
              `CLOUDFLARE_API_TOKEN cannot see zone "${zone}". Give the token Zone:Read and DNS:Edit on this zone, or check that the zone is in the token's account.`
            ),
          onSome: (z: CloudflareZone) => _pass(access, `CLOUDFLARE_API_TOKEN sees zone "${zone}" (status ${z.status ?? "unknown"}).`)
        })
      })
    }

    const delegation = Effect.map(found, (result) => ({
      provider: "Cloudflare",
      assigned: Result.isSuccess(result) ? Option.getOrUndefined(result.success)?.name_servers : undefined,
      suffix: ".ns.cloudflare.com"
    }))

    return [accessCheck, _delegationCheck({ name: "cloudflare-dns-delegation", zone, delegation })]
  })

const _godaddyChecks = (
  { http, zone }: { readonly zone: string; readonly http: HttpClient.HttpClient }
): ReadonlyArray<DoctorCheck> => {
  const access = "godaddy-dns-zone-access"

  return [
    {
      name: access,
      run: godaddyHttpClientFromEnv().pipe(
        Effect.flatMap((client) => makeGodaddyDnsClient(client).probe({ zone })),
        Effect.provideService(HttpClient.HttpClient, http),
        Effect.match({
          onSuccess: () => _pass(access, `GODADDY_API_TOKEN can read the records of zone "${zone}".`),
          onFailure: (error) => _fail(access, renderCliError(error))
        })
      )
    },
    _delegationCheck({
      name: "godaddy-dns-delegation",
      zone,
      delegation: Effect.succeed({ provider: "GoDaddy", assigned: undefined, suffix: ".domaincontrol.com" })
    })
  ]
}

// Checks for the DNS module, run after the distro's own. Only cloudflare and godaddy have them so far.
export const dnsDoctorChecks = (config: ClusterConfig): Effect.Effect<ReadonlyArray<DoctorCheck>, never, HttpClient.HttpClient> =>
  Effect.gen(function*() {
    const dns = config.dns

    if (dns.module !== "cloudflare" && dns.module !== "godaddy") return []

    const http = yield* HttpClient.HttpClient

    return dns.module === "cloudflare"
      ? yield* _cloudflareChecks({ zone: dns.zone, http })
      : _godaddyChecks({ zone: dns.zone, http })
  })
