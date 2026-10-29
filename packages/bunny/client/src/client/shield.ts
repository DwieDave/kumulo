import { Effect, Option, Schema } from "effect"
import type * as HttpClient from "effect/http/HttpClient"
import * as HttpClientRequest from "effect/http/HttpClientRequest"
import {
  BunnyAccessListAction,
  BunnyAccessListType,
  BunnyBotDetectionExecutionMode,
  BunnyBotDetectionSensitivity,
  BunnyDDoSExecutionMode,
  BunnyDDoSSensitivity,
  BunnyRateLimitBlockTime,
  BunnyRateLimitCounterKey,
  BunnyRateLimitTimeframe,
  BunnyShieldPlan,
  BunnyWafMode
} from "../enums.ts"
import { bunnyRequester } from "./request.ts"
import type { BunnyError, BunnyErrorBody } from "../errors.ts"

const _nullable = <S extends Schema.Constraint>(schema: S) => Schema.optional(Schema.NullOr(schema))

export const BunnyShieldZone = Schema.Struct({
  shieldZoneId: Schema.Number,
  pullZoneId: _nullable(Schema.Number),
  planType: BunnyShieldPlan,
  wafEnabled: _nullable(Schema.Boolean),
  wafExecutionMode: BunnyWafMode,
  dDoSShieldSensitivity: BunnyDDoSSensitivity,
  dDoSExecutionMode: BunnyDDoSExecutionMode,
  whitelabelResponsePages: _nullable(Schema.Boolean),
  learningMode: _nullable(Schema.Boolean),
  rateLimitRulesLimit: Schema.Number,
  customWafRulesLimit: Schema.Number
})

export type BunnyShieldZone = typeof BunnyShieldZone.Type

export const BunnyShieldZoneSettings = Schema.Struct({
  planType: Schema.optional(BunnyShieldPlan),
  wafEnabled: Schema.optional(Schema.Boolean),
  wafExecutionMode: Schema.optional(BunnyWafMode),
  dDoSShieldSensitivity: Schema.optional(BunnyDDoSSensitivity),
  dDoSExecutionMode: Schema.optional(BunnyDDoSExecutionMode),
  whitelabelResponsePages: Schema.optional(Schema.Boolean),
  learningMode: Schema.optional(Schema.Boolean)
})

export type BunnyShieldZoneSettings = typeof BunnyShieldZoneSettings.Type

const _ChainedCondition = Schema.Struct({
  variableTypes: _nullable(Schema.Record(Schema.String, Schema.String)),
  operatorType: Schema.Number,
  value: _nullable(Schema.String),
  isNegated: _nullable(Schema.Boolean),
  isRegexVariable: _nullable(Schema.Boolean)
})

export const BunnyRateLimitConfiguration = Schema.Struct({
  actionType: Schema.Number,
  counterKeyType: BunnyRateLimitCounterKey,
  variableTypes: _nullable(Schema.Record(Schema.String, Schema.String)),
  operatorType: Schema.Number,
  severityType: _nullable(Schema.Number),
  transformationTypes: _nullable(Schema.Array(Schema.Number)),
  value: _nullable(Schema.String),
  isNegated: _nullable(Schema.Boolean),
  isRegexVariable: _nullable(Schema.Boolean),
  requestCount: Schema.Number,
  timeframe: BunnyRateLimitTimeframe,
  blockTime: BunnyRateLimitBlockTime,
  chainedRuleConditions: _nullable(Schema.Array(_ChainedCondition))
})

export type BunnyRateLimitConfiguration = typeof BunnyRateLimitConfiguration.Type

export const BunnyRateLimitRule = Schema.Struct({
  id: Schema.Number,
  shieldZoneId: Schema.Number,
  ruleName: _nullable(Schema.String),
  ruleDescription: _nullable(Schema.String),
  ruleConfiguration: BunnyRateLimitConfiguration
})

export type BunnyRateLimitRule = typeof BunnyRateLimitRule.Type

export const BunnyAccessListDetails = Schema.Struct({
  listId: Schema.Number,
  configurationId: Schema.Number,
  name: _nullable(Schema.String),
  description: _nullable(Schema.String),
  isEnabled: Schema.Boolean,
  type: BunnyAccessListType,
  action: BunnyAccessListAction,
  entryCount: _nullable(Schema.Number)
})

export type BunnyAccessListDetails = typeof BunnyAccessListDetails.Type

export const BunnyCustomAccessList = Schema.Struct({
  id: Schema.Number,
  name: _nullable(Schema.String),
  description: _nullable(Schema.String),
  type: BunnyAccessListType,
  content: _nullable(Schema.String),
  checksum: _nullable(Schema.String),
  entryCount: _nullable(Schema.Number)
})

export type BunnyCustomAccessList = typeof BunnyCustomAccessList.Type

export interface BunnyAccessListLimits {
  readonly customListLimit: number | undefined
  readonly customListCount: number | undefined
  readonly customEntryLimit: number | undefined
  readonly customEntryCount: number | undefined
}

export interface BunnyAccessListOverview {
  readonly managedLists: ReadonlyArray<BunnyAccessListDetails>
  readonly customLists: ReadonlyArray<BunnyAccessListDetails>
  readonly limits: BunnyAccessListLimits
}

const _Sensitivity = Schema.Struct({ sensitivity: BunnyBotDetectionSensitivity })

export const BunnyBotDetection = Schema.Struct({
  shieldZoneId: Schema.Number,
  executionMode: BunnyBotDetectionExecutionMode,
  requestIntegrity: _Sensitivity,
  ipAddress: _Sensitivity,
  browserFingerprint: Schema.Struct({
    sensitivity: BunnyBotDetectionSensitivity,
    aggression: _nullable(Schema.Number),
    complexEnabled: _nullable(Schema.Boolean)
  })
})

export type BunnyBotDetection = typeof BunnyBotDetection.Type

const _ZoneEnvelope = Schema.Struct({ data: BunnyShieldZone })

const _OptionalZoneEnvelope = Schema.Struct({ data: Schema.NullOr(BunnyShieldZone) })

const _CreatedZoneEnvelope = Schema.Struct({
  data: Schema.Struct({ shieldZone: Schema.Struct({ shieldZoneId: Schema.Number }) })
})

const _pageSize = 100

const _RuleListEnvelope = Schema.Struct({ data: _nullable(Schema.Array(BunnyRateLimitRule)) })

const _AccessListsEnvelope = Schema.Struct({
  managedLists: _nullable(Schema.Array(BunnyAccessListDetails)),
  customLists: _nullable(Schema.Array(BunnyAccessListDetails)),
  customEntryCount: _nullable(Schema.Number),
  customEntryLimit: _nullable(Schema.Number),
  customListCount: _nullable(Schema.Number),
  customListLimit: _nullable(Schema.Number)
})

const _CustomListEnvelope = Schema.Struct({ data: BunnyCustomAccessList })

const _BotDetectionEnvelope = Schema.Struct({ data: BunnyBotDetection })

const _CreateZoneRequest = Schema.Struct({ pullZoneId: Schema.Number, shieldZone: BunnyShieldZoneSettings })

const _PatchZoneRequest = Schema.Struct({ shieldZoneId: Schema.Number, shieldZone: BunnyShieldZoneSettings })

const _RateLimitRequest = Schema.Struct({
  shieldZoneId: Schema.optional(Schema.Number),
  ruleName: Schema.String,
  ruleDescription: Schema.optional(Schema.String),
  ruleConfiguration: BunnyRateLimitConfiguration
})

const _CreateListRequest = Schema.Struct({
  name: Schema.String,
  description: Schema.optional(Schema.String),
  type: BunnyAccessListType,
  content: Schema.optional(Schema.String)
})

const _UpdateListRequest = Schema.Struct({ name: Schema.optional(Schema.String), content: Schema.optional(Schema.String) })

const _ListConfigurationRequest = Schema.Struct({
  isEnabled: Schema.optional(Schema.Boolean),
  action: Schema.optional(BunnyAccessListAction)
})

const _BotDetectionPatch = Schema.Struct({
  shieldZoneId: Schema.Number,
  executionMode: Schema.optional(BunnyBotDetectionExecutionMode),
  requestIntegrity: Schema.optional(_Sensitivity),
  ipAddress: Schema.optional(_Sensitivity),
  browserFingerprint: Schema.optional(Schema.Struct({
    sensitivity: BunnyBotDetectionSensitivity,
    aggression: Schema.optional(Schema.Number),
    complexEnabled: Schema.optional(Schema.Boolean)
  }))
})

export type BunnyBotDetectionPatch = typeof _BotDetectionPatch.Type

const _NestedError = Schema.Struct({
  errorKey: _nullable(Schema.String),
  message: _nullable(Schema.String)
})

const _ErrorEnvelope = Schema.Struct({
  error: _nullable(_NestedError),
  errorResponse: _nullable(_NestedError),
  errorKey: _nullable(Schema.String),
  message: _nullable(Schema.String)
})

const _decodeErrorEnvelope = Schema.decodeUnknownOption(Schema.fromJsonString(_ErrorEnvelope))

const _errorBody = (text: string): BunnyErrorBody | undefined =>
  Option.match(_decodeErrorEnvelope(text), {
    onNone: () => undefined,
    onSome: (envelope) => {
      const nested = envelope.errorResponse ?? envelope.error

      return {
        errorKey: nested?.errorKey ?? envelope.errorKey ?? undefined,
        message: nested?.message ?? envelope.message ?? undefined,
        field: undefined
      }
    }
  })

export interface BunnyShieldClient {
  readonly getShieldZone: (shieldZoneId: number) => Effect.Effect<BunnyShieldZone, BunnyError>
  readonly getShieldZoneByPullZone: (pullZoneId: number) => Effect.Effect<Option.Option<BunnyShieldZone>, BunnyError>
  readonly createShieldZone: (
    input: { readonly pullZoneId: number; readonly settings: BunnyShieldZoneSettings }
  ) => Effect.Effect<BunnyShieldZone, BunnyError>
  readonly patchShieldZone: (
    input: { readonly shieldZoneId: number; readonly settings: BunnyShieldZoneSettings }
  ) => Effect.Effect<BunnyShieldZone, BunnyError>
  readonly listRateLimits: (shieldZoneId: number) => Effect.Effect<ReadonlyArray<BunnyRateLimitRule>, BunnyError>
  readonly getRateLimit: (id: number) => Effect.Effect<BunnyRateLimitRule, BunnyError>
  readonly createRateLimit: (
    input: {
      readonly shieldZoneId: number
      readonly ruleName: string
      readonly ruleDescription?: string
      readonly ruleConfiguration: BunnyRateLimitConfiguration
    }
  ) => Effect.Effect<BunnyRateLimitRule, BunnyError>
  readonly updateRateLimit: (
    input: {
      readonly id: number
      readonly ruleName: string
      readonly ruleDescription?: string
      readonly ruleConfiguration: BunnyRateLimitConfiguration
    }
  ) => Effect.Effect<BunnyRateLimitRule, BunnyError>
  readonly deleteRateLimit: (id: number) => Effect.Effect<void, BunnyError>
  readonly listAccessLists: (shieldZoneId: number) => Effect.Effect<BunnyAccessListOverview, BunnyError>
  readonly getAccessList: (
    input: { readonly shieldZoneId: number; readonly id: number }
  ) => Effect.Effect<BunnyCustomAccessList, BunnyError>
  readonly createAccessList: (
    input: {
      readonly shieldZoneId: number
      readonly name: string
      readonly description?: string
      readonly type: BunnyAccessListType
      readonly content?: string
    }
  ) => Effect.Effect<BunnyCustomAccessList, BunnyError>
  readonly updateAccessList: (
    input: { readonly shieldZoneId: number; readonly id: number; readonly name?: string; readonly content?: string }
  ) => Effect.Effect<BunnyCustomAccessList, BunnyError>
  readonly deleteAccessList: (input: { readonly shieldZoneId: number; readonly id: number }) => Effect.Effect<void, BunnyError>
  readonly updateAccessListConfiguration: (
    input: {
      readonly shieldZoneId: number
      readonly configurationId: number
      readonly isEnabled?: boolean
      readonly action?: BunnyAccessListAction
    }
  ) => Effect.Effect<void, BunnyError>
  readonly getBotDetection: (shieldZoneId: number) => Effect.Effect<BunnyBotDetection, BunnyError>
  readonly updateBotDetection: (input: BunnyBotDetectionPatch) => Effect.Effect<BunnyBotDetection, BunnyError>
}

interface _Target {
  readonly kind: string
  readonly ref: string
}

type _BodyResult<S extends Schema.Constraint> = Effect.Effect<S["Type"], BunnyError>

const _withBody = <S extends Schema.Constraint & { readonly EncodingServices: never }>(
  { schema, request, body }: { readonly schema: S; readonly request: HttpClientRequest.HttpClientRequest; readonly body: S["Type"] }
): Effect.Effect<HttpClientRequest.HttpClientRequest> =>
  HttpClientRequest.schemaBodyJson(schema)(body)(request).pipe(Effect.orDie)

const _zoneTarget = (id: number): _Target => ({ kind: "shield-zone", ref: String(id) })

const _ruleTarget = (id: number): _Target => ({ kind: "rate-limit", ref: String(id) })

const _listTarget = ({ id, shieldZoneId }: { readonly shieldZoneId: number; readonly id: number }): _Target => ({
  kind: "access-list",
  ref: `${shieldZoneId}/${id}`
})

const _botTarget = (id: number): _Target => ({ kind: "bot-detection", ref: String(id) })

export const makeBunnyShieldClient = (httpClient: HttpClient.HttpClient): BunnyShieldClient => {
  const requester = bunnyRequester({ httpClient, parseBody: _errorBody, rejectAccepted: true })

  const _send = ({ request, target }: { readonly request: HttpClientRequest.HttpClientRequest; readonly target: _Target }) =>
    requester.send({ request, ...target })

  const _json = <S extends Schema.Constraint & { readonly DecodingServices: never }>(
    { schema, request, target }: { readonly schema: S; readonly request: HttpClientRequest.HttpClientRequest; readonly target: _Target }
  ): _BodyResult<S> => requester.json({ schema: schema, request, ...target })

  const _empty = (
    { request, target }: { readonly request: HttpClientRequest.HttpClientRequest; readonly target: _Target }
  ): Effect.Effect<void, BunnyError> => requester.empty({ request, ...target })

  const getShieldZone = (shieldZoneId: number) =>
    _json({
      schema: _ZoneEnvelope,
      request: HttpClientRequest.get(`/shield/shield-zone/${shieldZoneId}`),
      target: _zoneTarget(shieldZoneId)
    }).pipe(Effect.map((envelope) => envelope.data))

  const getShieldZoneByPullZone = (pullZoneId: number) =>
    _json({
      schema: _OptionalZoneEnvelope,
      request: HttpClientRequest.get(`/shield/shield-zone/get-by-pullzone/${pullZoneId}`),
      target: { kind: "shield-zone", ref: `pullzone/${pullZoneId}` }
    }).pipe(
      Effect.map((envelope) => Option.fromNullishOr(envelope.data)),
      Effect.catchTags({
        ResourceNotFound: () => Effect.succeed(Option.none<BunnyShieldZone>()),
        ProviderApiError: (error) =>
          error.status === 202 ? Effect.succeed(Option.none<BunnyShieldZone>()) : Effect.fail(error)
      })
    )

  const createShieldZone = ({ pullZoneId, settings }: { readonly pullZoneId: number; readonly settings: BunnyShieldZoneSettings }) =>
    _withBody({
      schema: _CreateZoneRequest,
      request: HttpClientRequest.post("/shield/shield-zone"),
      body: { pullZoneId, shieldZone: settings }
    }).pipe(
      Effect.flatMap((request) =>
        _json({ schema: _CreatedZoneEnvelope, request, target: { kind: "shield-zone", ref: `pullzone/${pullZoneId}` } })
      ),
      Effect.flatMap((envelope) => getShieldZone(envelope.data.shieldZone.shieldZoneId))
    )

  const patchShieldZone = ({ settings, shieldZoneId }: { readonly shieldZoneId: number; readonly settings: BunnyShieldZoneSettings }) =>
    _withBody({
      schema: _PatchZoneRequest,
      request: HttpClientRequest.patch("/shield/shield-zone"),
      body: { shieldZoneId, shieldZone: settings }
    }).pipe(
      Effect.flatMap((request) => _empty({ request, target: _zoneTarget(shieldZoneId) })),
      Effect.flatMap(() => getShieldZone(shieldZoneId))
    )

  const listRateLimits = (shieldZoneId: number) =>
    Effect.gen(function*() {
      const rules: Array<BunnyRateLimitRule> = []
      let page = 1

      while (true) {
        const envelope = yield* _json({
          schema: _RuleListEnvelope,
          request: HttpClientRequest.get(`/shield/rate-limits/${shieldZoneId}`).pipe(
            HttpClientRequest.setUrlParams({ page: String(page), perPage: String(_pageSize) })
          ),
          target: { kind: "rate-limit", ref: `zone/${shieldZoneId}` }
        })

        const data = envelope.data ?? []
        rules.push(...data)

        if (data.length < _pageSize) return rules

        page += 1
      }
    })

  const getRateLimit = (id: number) =>
    _json({ schema: BunnyRateLimitRule, request: HttpClientRequest.get(`/shield/rate-limit/${id}`), target: _ruleTarget(id) })

  const createRateLimit = (
    input: { readonly shieldZoneId: number; readonly ruleName: string; readonly ruleDescription?: string; readonly ruleConfiguration: BunnyRateLimitConfiguration }
  ) =>
    _withBody({ schema: _RateLimitRequest, request: HttpClientRequest.post("/shield/rate-limit"), body: input }).pipe(
      Effect.flatMap((request) =>
        _json({ schema: BunnyRateLimitRule, request, target: { kind: "rate-limit", ref: `${input.shieldZoneId}/${input.ruleName}` } })
      )
    )

  const updateRateLimit = (
    { id, ...rest }: { readonly id: number; readonly ruleName: string; readonly ruleDescription?: string; readonly ruleConfiguration: BunnyRateLimitConfiguration }
  ) =>
    _withBody({ schema: _RateLimitRequest, request: HttpClientRequest.patch(`/shield/rate-limit/${id}`), body: rest }).pipe(
      Effect.flatMap((request) => _empty({ request, target: _ruleTarget(id) })),
      Effect.flatMap(() => getRateLimit(id))
    )

  const deleteRateLimit = (id: number) =>
    _empty({ request: HttpClientRequest.delete(`/shield/rate-limit/${id}`), target: _ruleTarget(id) })

  const listAccessLists = (shieldZoneId: number) =>
    _json({
      schema: _AccessListsEnvelope,
      request: HttpClientRequest.get(`/shield/shield-zone/${shieldZoneId}/access-lists`),
      target: { kind: "access-list", ref: `zone/${shieldZoneId}` }
    }).pipe(
      Effect.map((envelope): BunnyAccessListOverview => ({
        managedLists: envelope.managedLists ?? [],
        customLists: envelope.customLists ?? [],
        limits: {
          customListLimit: envelope.customListLimit ?? undefined,
          customListCount: envelope.customListCount ?? undefined,
          customEntryLimit: envelope.customEntryLimit ?? undefined,
          customEntryCount: envelope.customEntryCount ?? undefined
        }
      }))
    )

  const getAccessList = (input: { readonly shieldZoneId: number; readonly id: number }) =>
    _json({
      schema: _CustomListEnvelope,
      request: HttpClientRequest.get(`/shield/shield-zone/${input.shieldZoneId}/access-lists/${input.id}`),
      target: _listTarget(input)
    }).pipe(Effect.map((envelope) => envelope.data))

  const createAccessList = (
    { shieldZoneId, ...rest }: { readonly shieldZoneId: number; readonly name: string; readonly description?: string; readonly type: BunnyAccessListType; readonly content?: string }
  ) =>
    _withBody({
      schema: _CreateListRequest,
      request: HttpClientRequest.post(`/shield/shield-zone/${shieldZoneId}/access-lists`),
      body: rest
    }).pipe(
      Effect.flatMap((request) =>
        _json({ schema: _CustomListEnvelope, request, target: { kind: "access-list", ref: `${shieldZoneId}/${rest.name}` } })
      ),
      Effect.map((envelope) => envelope.data)
    )

  const updateAccessList = (
    { id, shieldZoneId, ...rest }: { readonly shieldZoneId: number; readonly id: number; readonly name?: string; readonly content?: string }
  ) =>
    _withBody({
      schema: _UpdateListRequest,
      request: HttpClientRequest.patch(`/shield/shield-zone/${shieldZoneId}/access-lists/${id}`),
      body: rest
    }).pipe(
      Effect.flatMap((request) => _empty({ request, target: _listTarget({ shieldZoneId, id }) })),
      Effect.flatMap(() => getAccessList({ shieldZoneId, id }))
    )

  const deleteAccessList = (input: { readonly shieldZoneId: number; readonly id: number }) =>
    _empty({
      request: HttpClientRequest.delete(`/shield/shield-zone/${input.shieldZoneId}/access-lists/${input.id}`),
      target: _listTarget(input)
    })

  const updateAccessListConfiguration = (
    { configurationId, shieldZoneId, ...rest }: { readonly shieldZoneId: number; readonly configurationId: number; readonly isEnabled?: boolean; readonly action?: BunnyAccessListAction }
  ) =>
    _withBody({
      schema: _ListConfigurationRequest,
      request: HttpClientRequest.patch(`/shield/shield-zone/${shieldZoneId}/access-lists/configurations/${configurationId}`),
      body: rest
    }).pipe(
      Effect.flatMap((request) =>
        _empty({ request, target: { kind: "access-list-configuration", ref: `${shieldZoneId}/${configurationId}` } })
      )
    )

  const getBotDetection = (shieldZoneId: number) =>
    _json({
      schema: _BotDetectionEnvelope,
      request: HttpClientRequest.get(`/shield/shield-zone/${shieldZoneId}/bot-detection`),
      target: _botTarget(shieldZoneId)
    }).pipe(Effect.map((envelope) => envelope.data))

  const updateBotDetection = (input: BunnyBotDetectionPatch) =>
    _withBody({
      schema: _BotDetectionPatch,
      request: HttpClientRequest.patch(`/shield/shield-zone/${input.shieldZoneId}/bot-detection`),
      body: input
    }).pipe(
      Effect.flatMap((request) => _empty({ request, target: _botTarget(input.shieldZoneId) })),
      Effect.flatMap(() => getBotDetection(input.shieldZoneId))
    )

  return {
    getShieldZone,
    getShieldZoneByPullZone,
    createShieldZone,
    patchShieldZone,
    listRateLimits,
    getRateLimit,
    createRateLimit,
    updateRateLimit,
    deleteRateLimit,
    listAccessLists,
    getAccessList,
    createAccessList,
    updateAccessList,
    deleteAccessList,
    updateAccessListConfiguration,
    getBotDetection,
    updateBotDetection
  }
}
