import { Duration, Effect, Layer, Option, Predicate, Ref, Schedule } from "effect"
import { CapabilityMissing, CdnProvider, ProvisioningTimeout, ResourceConflict } from "@kumulo/core"
import type { CdnCacheMode, CdnError, CdnTier, EdgeInfo, EdgeRef, EdgeSpec } from "@kumulo/core"
import type { BunnyError, BunnyPullZone, BunnyPullZoneClient, BunnyPullZoneSettings } from "@kumulo/bunny"
import type { BunnyShield } from "./shield.ts"

export const bunnyHostnameLimit = 10

export interface CertificateStatus {
  readonly hostname: string
  readonly status: "issued" | "timeout"
}

export interface BunnyCdnProviderOptions {
  readonly pullZone: BunnyPullZoneClient
  readonly ownedId?: number | undefined
  readonly onCreated?: (zone: { readonly id: number; readonly systemHostname: string }) => Effect.Effect<void, CdnError>
  readonly shield?: BunnyShield
  readonly certificateTimeout?: Duration.Input
  readonly certificateBaseDelay?: Duration.Input
}

const _kind = "pullzone"

const _toCdnError = (error: BunnyError): CdnError => error

const _mapped = <A>(self: Effect.Effect<A, BunnyError>): Effect.Effect<A, CdnError> => Effect.mapError(self, _toCdnError)

const _tier = (zone: BunnyPullZone): CdnTier => (zone.Type === "Volume" ? "volume" : "standard")

const _cache = (zone: BunnyPullZone): CdnCacheMode => (zone.EnableSmartCache ? "smart" : "origin")

const _custom = (zone: BunnyPullZone) => zone.Hostnames.filter((hostname) => !hostname.IsSystemHostname)

const _toInfo = (zone: BunnyPullZone): EdgeInfo => {
  const custom = _custom(zone)
  const system = zone.Hostnames.find((hostname) => hostname.IsSystemHostname)

  return {
    ref: { id: String(zone.Id), name: zone.Name },
    originUrl: zone.OriginUrl ?? "",
    verifyOriginTls: zone.VerifyOriginSSL,
    websockets: zone.EnableWebSockets,
    cache: _cache(zone),
    tier: _tier(zone),
    forceSsl: custom.length > 0 && custom.every((hostname) => hostname.ForceSSL),
    defaultHostname: system?.Value ?? `${zone.Name}.b-cdn.net`,
    hostnames: custom.map((hostname) => hostname.Value),
    certificatesIssued: custom.filter((hostname) => hostname.HasCertificate).map((hostname) => hostname.Value)
  }
}

const _desired = (spec: EdgeSpec): BunnyPullZoneSettings => ({
  type: spec.tier === "volume" ? "Volume" : "Premium",
  originUrl: spec.originUrl,
  addHostHeader: true,
  verifyOriginSSL: spec.verifyOriginTls,
  enableWebSockets: spec.websockets,
  enableSmartCache: spec.cache === "smart",
  enableHostnameVary: true,
  disableCookies: false
})

const _current = (zone: BunnyPullZone): BunnyPullZoneSettings => ({
  type: zone.Type,
  originUrl: zone.OriginUrl ?? "",
  addHostHeader: zone.AddHostHeader,
  verifyOriginSSL: zone.VerifyOriginSSL,
  enableWebSockets: zone.EnableWebSockets,
  enableSmartCache: zone.EnableSmartCache,
  enableHostnameVary: zone.EnableHostnameVary,
  disableCookies: zone.DisableCookies
})

const _same = (left: BunnyPullZoneSettings, right: BunnyPullZoneSettings): boolean =>
  left.type === right.type
  && left.originUrl === right.originUrl
  && left.addHostHeader === right.addHostHeader
  && left.verifyOriginSSL === right.verifyOriginSSL
  && left.enableWebSockets === right.enableWebSockets
  && left.enableSmartCache === right.enableSmartCache
  && left.enableHostnameVary === right.enableHostnameVary
  && left.disableCookies === right.disableCookies

const _transient = (error: BunnyError): boolean =>
  Predicate.isTagged(error, "ProviderApiError") && (error.status === 400 || error.status >= 500)

const _idOf = (ref: EdgeRef): number => Number(ref.id)

export const makeBunnyCdnProvider = (options: BunnyCdnProviderOptions) => {
  const client = options.pullZone
  const timeout = options.certificateTimeout ?? Duration.minutes(10)
  const baseDelay = options.certificateBaseDelay ?? Duration.seconds(5)

  const forceSsl = Ref.makeUnsafe(true)

  const _unconfigured = Effect.fail(
    new CapabilityMissing({ capability: "shield", region: "bunny.net", workaround: "no bunny shield client configured" })
  )

  const shield = options.shield

  const ensureSecurity = (input: Parameters<BunnyShield["ensureSecurity"]>[0]) =>
    shield === undefined ? _unconfigured : shield.ensureSecurity(input)

  const resetSecurity = (ref: EdgeRef) => (shield === undefined ? Effect.void : shield.resetSecurity(ref))

  const obtainZone = (spec: EdgeSpec): Effect.Effect<BunnyPullZone, CdnError> =>
    Effect.gen(function*() {
      if (spec.hostnames.length > bunnyHostnameLimit) {
        return yield* Effect.fail(
          new CapabilityMissing({
            capability: "pullzone.hostnames",
            region: "bunny.net",
            workaround: `bunny allows at most ${bunnyHostnameLimit} custom hostnames per pull zone`
          })
        )
      }

      if (options.ownedId !== undefined) return yield* _mapped(client.getPullZone({ id: options.ownedId }))

      const available = yield* _mapped(client.checkAvailability({ name: spec.name }))

      if (!available) return yield* Effect.fail(new ResourceConflict({ kind: _kind, ref: spec.name }))

      const created = yield* _mapped(client.createPullZone({ name: spec.name, settings: _desired(spec) }))

      if (options.onCreated !== undefined) {
        yield* options.onCreated({
          id: created.Id,
          systemHostname: created.Hostnames.find((hostname) => hostname.IsSystemHostname)?.Value ?? `${created.Name}.b-cdn.net`
        })
      }

      return created
    })

  const ensureEdge = (spec: EdgeSpec): Effect.Effect<EdgeInfo, CdnError> =>
    Effect.gen(function*() {
      yield* Ref.set(forceSsl, spec.forceSsl)

      const zone = yield* obtainZone(spec)
      const desired = _desired(spec)

      if (!_same(_current(zone), desired)) yield* _mapped(client.updatePullZone({ id: zone.Id, settings: desired }))

      const existing = _custom(zone).map((hostname) => hostname.Value)

      yield* Effect.forEach(
        spec.hostnames.filter((hostname) => !existing.includes(hostname)),
        (hostname) => _mapped(client.addHostname({ id: zone.Id, hostname })),
        { discard: true }
      )

      yield* Effect.forEach(
        existing.filter((hostname) => !spec.hostnames.includes(hostname)),
        (hostname) => _mapped(client.removeHostname({ id: zone.Id, hostname })),
        { discard: true }
      )

      return _toInfo(yield* _mapped(client.getPullZone({ id: zone.Id })))
    })

  const describeEdge = (ref: EdgeRef): Effect.Effect<EdgeInfo, CdnError> =>
    Effect.map(_mapped(client.getPullZone({ id: _idOf(ref) })), _toInfo)

  const issue = (hostname: string): Effect.Effect<CertificateStatus, CdnError> =>
    client.loadFreeCertificate({ hostname }).pipe(
      Effect.retry({
        schedule: Schedule.min([Schedule.exponential(baseDelay, 2), Schedule.spaced(Duration.minutes(1))]),
        while: _transient
      }),
      Effect.as<CertificateStatus["status"]>("issued"),
      Effect.timeoutOption(timeout),
      Effect.map(Option.getOrElse(() => "timeout" as const)),
      Effect.map((status) => ({ hostname, status }))
    )

  const ensureCertificatesReport = (
    { hostnames, ref }: { readonly ref: EdgeRef; readonly hostnames: ReadonlyArray<string> }
  ): Effect.Effect<ReadonlyArray<CertificateStatus>, CdnError> =>
    Effect.gen(function*() {
      const id = _idOf(ref)
      const zone = yield* _mapped(client.getPullZone({ id }))
      const wantSsl = yield* Ref.get(forceSsl)

      return yield* Effect.forEach(hostnames, (hostname) =>
        Effect.gen(function*() {
          const entry = zone.Hostnames.find((candidate) => candidate.Value === hostname)

          if (entry === undefined) return yield* Effect.fail(new ResourceConflict({ kind: "hostname", ref: hostname }))

          const status = entry.HasCertificate ? { hostname, status: "issued" as const } : yield* issue(hostname)

          const needsFlip = entry.ForceSSL !== wantSsl && (!wantSsl || status.status === "issued")

          if (needsFlip) yield* _mapped(client.setForceSSL({ id, hostname, forceSSL: wantSsl }))

          return status
        }), { concurrency: "unbounded" })
    })

  const ensureCertificates = (
    input: { readonly ref: EdgeRef; readonly hostnames: ReadonlyArray<string> }
  ): Effect.Effect<void, CdnError> =>
    Effect.flatMap(ensureCertificatesReport(input), (statuses) => {
      const failed = statuses.filter((status) => status.status === "timeout").map((status) => status.hostname)

      return failed.length === 0
        ? Effect.void
        : Effect.fail(new ProvisioningTimeout({ kind: "certificate", ref: input.ref.name, lastStatus: failed.join(",") }))
    })

  const deleteEdge = (ref: EdgeRef): Effect.Effect<void, CdnError> => _mapped(client.deletePullZone({ id: _idOf(ref) }))

  return { ensureEdge, ensureCertificates, ensureCertificatesReport, ensureSecurity, resetSecurity, describeEdge, deleteEdge }
}

export const bunnyCdnProviderLive = (options: BunnyCdnProviderOptions) => {
  const { ensureCertificates, ensureEdge, ensureSecurity: security, describeEdge, deleteEdge } = makeBunnyCdnProvider(options)

  return Layer.succeed(CdnProvider, { ensureEdge, ensureCertificates, ensureSecurity: security, describeEdge, deleteEdge })
}
