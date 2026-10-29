import { Effect, Layer, Match, Predicate, Ref } from "effect"
import { FileSystem } from "effect/FileSystem"
import * as HttpClient from "effect/http/HttpClient"
import type { PlatformError } from "effect/PlatformError"
import { CdnProvider, ConfigInvalid, ProviderApiError, PlanAction, cdnNoopLive } from "@kumulo/core"
import type {
  AuthenticationFailed,
  CdnError,
  EdgeInfo,
  EdgeRef,
  EdgeSpec,
  Sensitivity,
  SecurityPolicy
} from "@kumulo/core"
import { makeBunnyHttpClient, makeBunnyPullZoneClient, makeBunnyShieldClient } from "@kumulo/bunny"
import {
  diffEdge,
  makeBunnyCdnProvider,
  makeBunnyShield,
  readCdnOutputs,
  writeCdnOutputs
} from "@kumulo/cdn-bunny"
import type { CdnOutputsFile } from "@kumulo/cdn-bunny"
import type { ClusterConfig } from "./cluster-config.ts"
import type { DnsTarget } from "./dns.ts"
import { requiredRedactedEnv } from "./env.ts"

export type CdnHandleError = AuthenticationFailed | ConfigInvalid | PlatformError

export type CdnStepError = CdnError | ConfigInvalid | PlatformError

type BunnyCdnConfig = Extract<NonNullable<ClusterConfig["cdn"]>, { readonly module: "bunny" }>

export interface CdnHandle {
  readonly name: string
  readonly provider: CdnProvider["Service"]
  readonly state: Ref.Ref<CdnOutputsFile>
  readonly persist: Effect.Effect<void, PlatformError>
  readonly warnings: Ref.Ref<ReadonlyArray<string>>
}

const _bunnyConfig = (config: ClusterConfig): BunnyCdnConfig | undefined =>
  config.cdn === undefined || config.cdn.module === "none" ? undefined : config.cdn

export const wantsCdn = (config: ClusterConfig): boolean => _bunnyConfig(config) !== undefined

export const cdnTargetKind = (config: ClusterConfig): "hostname" | undefined => (wantsCdn(config) ? "hostname" : undefined)

export const cdnHandleFor = (
  { config, configDir }: { readonly config: ClusterConfig; readonly configDir: string }
): Effect.Effect<CdnHandle | undefined, CdnHandleError, FileSystem | HttpClient.HttpClient> =>
  Effect.gen(function*() {
    const cdn = _bunnyConfig(config)

    if (cdn === undefined) return undefined
    const apiKey = yield* requiredRedactedEnv("BUNNYNET_API_KEY")
    const base = yield* HttpClient.HttpClient
    const httpClient = makeBunnyHttpClient({ base, apiKey })
    const fs = yield* FileSystem
    const format = config.outputs?.format

    const file = yield* readCdnOutputs({ dir: configDir, tag: config.name, format }).pipe(
      Effect.mapError((error) =>
        Predicate.isTagged(error, "CdnOutputsInvalid")
          ? new ConfigInvalid({ issues: [{ path: ["cdn"], message: `${configDir}: ${error.message}` }] })
          : error
      )
    )

    const state = yield* Ref.make(file)
    const warnings = yield* Ref.make<ReadonlyArray<string>>([])
    const shield = makeBunnyShield({ shield: makeBunnyShieldClient(httpClient), outputs: state })

    const persist = Effect.flatMap(Ref.get(state), (current) => writeCdnOutputs({ dir: configDir, file: current, format })).pipe(
      Effect.provideService(FileSystem, fs)
    )

    const provider = makeBunnyCdnProvider({
      pullZone: makeBunnyPullZoneClient(httpClient),
      ownedId: file.pullZoneId,
      onCreated: ({ id, systemHostname }) =>
        Ref.update(state, (current) => ({ ...current, pullZoneId: id, systemHostname })).pipe(
          Effect.andThen(persist),
          Effect.mapError((error) => new ProviderApiError({ operation: "persist cdn outputs", status: 0, body: String(error) }))
        ),
      shield
    })

    return { name: cdn.name, provider, state, persist, warnings }
  })

export const cdnProviderLayerFor = (
  { config, configDir }: { readonly config: ClusterConfig; readonly configDir: string }
): Layer.Layer<CdnProvider, CdnHandleError, FileSystem | HttpClient.HttpClient> =>
  wantsCdn(config)
    ? Layer.effect(
      CdnProvider,
      Effect.map(cdnHandleFor({ config, configDir }), (handle) =>
        CdnProvider.of({
          ensureEdge: (spec) => handle === undefined ? Effect.die("cdn handle missing") : handle.provider.ensureEdge(spec),
          ensureCertificates: (input) =>
            handle === undefined ? Effect.die("cdn handle missing") : handle.provider.ensureCertificates(input),
          ensureSecurity: (input) =>
            handle === undefined ? Effect.die("cdn handle missing") : handle.provider.ensureSecurity(input),
          describeEdge: (ref) => handle === undefined ? Effect.die("cdn handle missing") : handle.provider.describeEdge(ref),
          deleteEdge: (ref) => handle === undefined ? Effect.die("cdn handle missing") : handle.provider.deleteEdge(ref)
        }))
    )
    : cdnNoopLive

export const pullZoneIdFor = (handle: CdnHandle | undefined): ((target: string) => number | undefined) => (target) => {
  if (handle === undefined) return undefined
  const file = Ref.getUnsafe(handle.state)

  return file.systemHostname === target ? file.pullZoneId : undefined
}

const _ddos = (sensitivity: "off" | "low" | "medium" | "high" | "challenge"): Sensitivity | undefined =>
  sensitivity === "challenge" ? undefined : sensitivity

const _policy = (
  shield: NonNullable<BunnyCdnConfig["shield"]>
): Effect.Effect<SecurityPolicy, ConfigInvalid> => {
  const sensitivity = _ddos(shield.ddos.sensitivity)

  return sensitivity === undefined
    ? Effect.fail(
      new ConfigInvalid({
        issues: [{ path: ["cdn", "shield", "ddos", "sensitivity"], message: "ddos sensitivity \"challenge\" is not supported by the bunny provider yet" }]
      })
    )
    : Effect.succeed({
      plan: shield.plan,
      waf: shield.waf,
      ddos: { sensitivity },
      botDetection: { mode: shield.bot_detection.mode, sensitivity: shield.bot_detection.sensitivity },
      rateLimits: shield.rate_limits.map((rule) => ({
        name: rule.name,
        pathPrefix: rule.path_prefix,
        requests: rule.requests,
        window: String(rule.window),
        blockFor: String(rule.block_for),
        key: rule.key
      })),
      accessLists: shield.access_lists.map((list) => ({
        name: list.name,
        type: list.type,
        action: list.action,
        entries: list.entries
      }))
    })
}

const _resetPolicy: SecurityPolicy = {
  plan: "basic",
  waf: { enabled: false, mode: "log" },
  ddos: { sensitivity: "off" },
  rateLimits: [],
  accessLists: []
}

const _originUrl = (
  { cdn, ingressIp, originUrl }: {
    readonly cdn: BunnyCdnConfig
    readonly ingressIp: string | undefined
    readonly originUrl: string | undefined
  }
): Effect.Effect<string, ConfigInvalid> => {
  if (cdn.origin === "ingress") {
    return ingressIp === undefined || ingressIp === ""
      ? Effect.fail(
        new ConfigInvalid({ issues: [{ path: ["cdn", "origin"], message: "cdn.origin ingress needs an ingress floating IP, none is available yet" }] })
      )
      : Effect.succeed(`https://${ingressIp}`)
  }

  return Effect.succeed(originUrl ?? cdn.origin.url)
}

const _edgeSpec = ({ cdn, originUrl }: { readonly cdn: BunnyCdnConfig; readonly originUrl: string }): EdgeSpec => ({
  name: cdn.name,
  tier: cdn.tier,
  originUrl,
  verifyOriginTls: cdn.verify_origin_tls,
  websockets: cdn.websockets,
  cache: cdn.cache,
  hostnames: cdn.hostnames,
  forceSsl: cdn.force_ssl
})

const _refOf = (handle: CdnHandle): Effect.Effect<EdgeRef | undefined> =>
  Effect.map(Ref.get(handle.state), (file) =>
    file.pullZoneId === undefined ? undefined : { id: String(file.pullZoneId), name: handle.name })

export const applyCdn = <E, R>(
  { cdn, config, dns, ingressIp, originUrl }: {
    readonly config: ClusterConfig
    readonly cdn: CdnHandle | undefined
    readonly ingressIp?: string | undefined
    readonly originUrl?: string | undefined
    readonly dns: (targets: { readonly cdn?: DnsTarget }) => Effect.Effect<void, E, R>
  }
): Effect.Effect<void, E | CdnStepError, R> =>
  Effect.gen(function*() {
    const cfg = _bunnyConfig(config)

    if (cfg === undefined || cdn === undefined) return yield* dns({})

    const origin = yield* _originUrl({ cdn: cfg, ingressIp, originUrl })
    const info: EdgeInfo = yield* cdn.provider.ensureEdge(_edgeSpec({ cdn: cfg, originUrl: origin }))

    yield* Ref.update(cdn.state, (file) => ({
      ...file,
      pullZoneId: Number(info.ref.id),
      systemHostname: info.defaultHostname
    }))
    yield* cdn.persist
    yield* dns({ cdn: { kind: "hostname", value: info.defaultHostname } })

    yield* cdn.provider.ensureCertificates({ ref: info.ref, hostnames: cfg.hostnames }).pipe(
      Effect.catchTag("ProvisioningTimeout", (timeout) =>
        Ref.update(cdn.warnings, (list) => [
          ...list,
          `TLS certificate not issued yet for ${timeout.lastStatus}; the edge serves HTTP until DNS resolves, re-run apply to retry`
        ])),
      Effect.catch((error) =>
        Ref.update(cdn.warnings, (list) => [
          ...list,
          `TLS certificate setup failed for ${cfg.hostnames.join(", ")} (${error._tag}); the edge serves HTTP, fix the hostname and re-run apply`
        ]))
    )

    if (cfg.shield === undefined) {
      const file = yield* Ref.get(cdn.state)

      if (file.shieldZoneId !== undefined) yield* cdn.provider.ensureSecurity({ ref: info.ref, policy: _resetPolicy })
    } else {
      yield* cdn.provider.ensureSecurity({ ref: info.ref, policy: yield* _policy(cfg.shield) })
    }

    yield* cdn.persist
  })

export const removeCdn = <E, R>(
  { cdn, dns }: { readonly cdn: CdnHandle | undefined; readonly dns: Effect.Effect<void, E, R> }
): Effect.Effect<void, E | CdnStepError, R> =>
  Effect.gen(function*() {
    yield* dns

    if (cdn === undefined) return
    const ref = yield* _refOf(cdn)

    if (ref === undefined) return
    const file = yield* Ref.get(cdn.state)

    const exists = yield* cdn.provider.describeEdge(ref).pipe(
      Effect.as(true),
      Effect.catchTag("ResourceNotFound", () => Effect.succeed(false))
    )

    if (exists && file.shieldZoneId !== undefined) yield* cdn.provider.ensureSecurity({ ref, policy: _resetPolicy })

    if (exists) {
      yield* cdn.provider.deleteEdge(ref).pipe(
        Effect.catchIf((error) => Predicate.isTagged(error, "ResourceNotFound"), () => Effect.void)
      )
    }

    yield* Ref.update(cdn.state, (current) => ({ cluster: current.cluster, rules: {}, lists: {} }))
    yield* cdn.persist
  })

export const cdnWarnings = (cdn: CdnHandle | undefined): Effect.Effect<string> =>
  cdn === undefined
    ? Effect.succeed("")
    : Effect.map(Ref.get(cdn.warnings), (list) => list.map((line) => `\nWarning: ${line}`).join(""))

const _row = (name: string): string => `cdn/${name}`

const _createRows = (cfg: BunnyCdnConfig): ReadonlyArray<PlanAction> => [
  PlanAction.Create({ name: _row(cfg.name) }),
  ...cfg.hostnames.map((host) => PlanAction.Create({ name: `${_row(cfg.name)}/hostname/${host}` })),
  ..._shieldRows({ cfg, file: undefined })
]

const _shieldRows = (
  { cfg, file }: { readonly cfg: BunnyCdnConfig; readonly file: CdnOutputsFile | undefined }
): ReadonlyArray<PlanAction> => {
  const shield = cfg.shield
  const base = `${_row(cfg.name)}/shield`
  const rules = file?.rules ?? {}
  const lists = file?.lists ?? {}

  if (shield === undefined) {
    return file?.shieldZoneId === undefined ? [] : [PlanAction.Update({ name: base, reason: "reset to basic plan, WAF off" })]
  }

  const wantedRules = new Set(shield.rate_limits.map((rule) => rule.name))
  const wantedLists = new Set(shield.access_lists.map((list) => list.name))

  return [
    file?.shieldZoneId === undefined
      ? PlanAction.Create({ name: base })
      : PlanAction.NoOp({ name: base }),
    ...shield.rate_limits.map((rule) =>
      rule.name in rules
        ? PlanAction.NoOp({ name: `${base}/rate-limit/${rule.name}` })
        : PlanAction.Create({ name: `${base}/rate-limit/${rule.name}` })
    ),
    ...Object.keys(rules).filter((name) => !wantedRules.has(name)).map((name) => PlanAction.Delete({ name: `${base}/rate-limit/${name}` })),
    ...shield.access_lists.map((list) =>
      list.name in lists
        ? PlanAction.NoOp({ name: `${base}/access-list/${list.name}` })
        : PlanAction.Create({ name: `${base}/access-list/${list.name}` })
    ),
    ...Object.keys(lists).filter((name) => !wantedLists.has(name)).map((name) => PlanAction.Delete({ name: `${base}/access-list/${name}` }))
  ]
}

const _zoneRows = (
  { cfg, file, info }: { readonly cfg: BunnyCdnConfig; readonly file: CdnOutputsFile; readonly info: EdgeInfo }
): ReadonlyArray<PlanAction> => {
  const spec = _edgeSpec({ cdn: cfg, originUrl: cfg.origin === "ingress" ? info.originUrl : cfg.origin.url })
  const drift = diffEdge({ spec, info })
  const name = _row(cfg.name)

  const zone = Match.value(drift).pipe(
    Match.when("Unchanged", () => PlanAction.NoOp({ name })),
    Match.when("Update", () => PlanAction.Update({ name, reason: "origin, hostnames or settings changed" })),
    Match.when("ReplaceNeedsConfirm", () =>
      PlanAction.ReplaceNeedsConfirm({ name, reason: "name or tier changed (immutable, delete+recreate)" })),
    Match.exhaustive
  )

  return [
    zone,
    ...cfg.hostnames.map((host) =>
      info.hostnames.includes(host)
        ? PlanAction.NoOp({ name: `${name}/hostname/${host}` })
        : PlanAction.Create({ name: `${name}/hostname/${host}` })
    ),
    ...info.hostnames.filter((host) => !cfg.hostnames.includes(host)).map((host) =>
      PlanAction.Delete({ name: `${name}/hostname/${host}` })
    ),
    ..._shieldRows({ cfg, file })
  ]
}

export const cdnPlanActions = (
  { cdn, config }: { readonly config: ClusterConfig; readonly cdn: CdnHandle | undefined }
): Effect.Effect<ReadonlyArray<PlanAction>, CdnError> =>
  Effect.gen(function*() {
    const cfg = _bunnyConfig(config)

    if (cfg === undefined) return []

    if (cdn === undefined) return _createRows(cfg)
    const file = yield* Ref.get(cdn.state)
    const ref = yield* _refOf(cdn)

    if (ref === undefined) return _createRows(cfg)

    return yield* cdn.provider.describeEdge(ref).pipe(
      Effect.map((info) => _zoneRows({ cfg, file, info })),
      Effect.catchTag("ResourceNotFound", () => Effect.succeed(_createRows(cfg)))
    )
  })

export const cdnDeletePlanActions = (
  { cdn, config }: { readonly config: ClusterConfig; readonly cdn: CdnHandle | undefined }
): Effect.Effect<ReadonlyArray<PlanAction>> =>
  Effect.gen(function*() {
    const cfg = _bunnyConfig(config)

    if (cfg === undefined) return []
    const name = _row(cfg.name)
    const file = cdn === undefined ? undefined : yield* Ref.get(cdn.state)

    if (file?.pullZoneId === undefined) return [PlanAction.NoOp({ name: `${name} (already absent)` })]

    const shield = file.shieldZoneId === undefined ? [] : [
      PlanAction.Update({ name: `${name}/shield`, reason: "reset to basic plan, WAF off" }),
      ...Object.keys(file.rules).map((rule) => PlanAction.Delete({ name: `${name}/shield/rate-limit/${rule}` })),
      ...Object.keys(file.lists).map((list) => PlanAction.Delete({ name: `${name}/shield/access-list/${list}` }))
    ]

    return [...shield, PlanAction.Delete({ name })]
  })

export const cdnStatusLines = (
  { cdn, config }: { readonly config: ClusterConfig; readonly cdn: CdnHandle | undefined }
): Effect.Effect<ReadonlyArray<string>> =>
  Effect.gen(function*() {
    const cfg = _bunnyConfig(config)

    if (cfg === undefined) return []

    if (cdn === undefined) return [`  CDN: ${cfg.name} (not created)`]
    const ref = yield* _refOf(cdn)

    if (ref === undefined) return [`  CDN: ${cfg.name} (not created)`]

    return yield* cdn.provider.describeEdge(ref).pipe(
      Effect.map((info) => {
        const hosts = info.hostnames.length === 0
          ? "(none)"
          : info.hostnames.map((host) => `${host} (${info.certificatesIssued.includes(host) ? "tls" : "no tls"})`).join(", ")

        return [`  CDN: ${info.ref.name} -> ${info.defaultHostname}, hostnames: ${hosts}`]
      }),
      Effect.catch(() => Effect.succeed([`  CDN: ${cfg.name} (unreachable)`]))
    )
  })
