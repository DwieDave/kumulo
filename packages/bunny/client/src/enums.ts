import { Schema, SchemaGetter } from "effect"

const _codec = <const I extends ReadonlyArray<number>, const N extends ReadonlyArray<string>>(
  { ints, names, toName, toInt }: {
    readonly ints: I
    readonly names: N
    readonly toName: { readonly [K in I[number]]: N[number] }
    readonly toInt: { readonly [K in N[number]]: I[number] }
  }
) =>
  Schema.Literals(ints).pipe(
    Schema.decodeTo(Schema.Literals(names), {
      decode: SchemaGetter.transform((value: I[number]): N[number] => toName[value]),
      encode: SchemaGetter.transform((value: N[number]): I[number] => toInt[value])
    })
  )

export const BunnyDnsRecordType = _codec({
  ints: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
  names: ["A", "AAAA", "CNAME", "TXT", "MX", "Redirect", "Flatten", "PullZone", "SRV", "CAA", "PTR", "Script", "NS", "SVCB", "HTTPS", "TLSA"],
  toName: { 0: "A", 1: "AAAA", 2: "CNAME", 3: "TXT", 4: "MX", 5: "Redirect", 6: "Flatten", 7: "PullZone", 8: "SRV", 9: "CAA", 10: "PTR", 11: "Script", 12: "NS", 13: "SVCB", 14: "HTTPS", 15: "TLSA" },
  toInt: { "A": 0, "AAAA": 1, "CNAME": 2, "TXT": 3, "MX": 4, "Redirect": 5, "Flatten": 6, "PullZone": 7, "SRV": 8, "CAA": 9, "PTR": 10, "Script": 11, "NS": 12, "SVCB": 13, "HTTPS": 14, "TLSA": 15 }
})

export type BunnyDnsRecordType = typeof BunnyDnsRecordType.Type

export const BunnyStorageZoneTier = _codec({
  ints: [0, 1],
  names: ["Standard", "Edge"],
  toName: { 0: "Standard", 1: "Edge" },
  toInt: { "Standard": 0, "Edge": 1 }
})

export type BunnyStorageZoneTier = typeof BunnyStorageZoneTier.Type

export const BunnyStorageZoneType = _codec({
  ints: [0, 1],
  names: ["NotSupported", "Supported"],
  toName: { 0: "NotSupported", 1: "Supported" },
  toInt: { "NotSupported": 0, "Supported": 1 }
})

export type BunnyStorageZoneType = typeof BunnyStorageZoneType.Type

export const BunnyPullZoneType = _codec({
  ints: [0, 1],
  names: ["Premium", "Volume"],
  toName: { 0: "Premium", 1: "Volume" },
  toInt: { "Premium": 0, "Volume": 1 }
})

export type BunnyPullZoneType = typeof BunnyPullZoneType.Type

export const BunnyPullZoneOriginType = _codec({
  ints: [0, 1, 2, 3, 4, 5, 6],
  names: ["OriginUrl", "DnsAccelerate", "StorageZone", "LoadBalancer", "EdgeScript", "MagicContainers", "PushZone"],
  toName: { 0: "OriginUrl", 1: "DnsAccelerate", 2: "StorageZone", 3: "LoadBalancer", 4: "EdgeScript", 5: "MagicContainers", 6: "PushZone" },
  toInt: { "OriginUrl": 0, "DnsAccelerate": 1, "StorageZone": 2, "LoadBalancer": 3, "EdgeScript": 4, "MagicContainers": 5, "PushZone": 6 }
})

export type BunnyPullZoneOriginType = typeof BunnyPullZoneOriginType.Type

export const BunnyOriginType = _codec({
  ints: [0, 1, 2, 3],
  names: ["Standard", "Storage", "EdgeScript", "MagicContainer"],
  toName: { 0: "Standard", 1: "Storage", 2: "EdgeScript", 3: "MagicContainer" },
  toInt: { "Standard": 0, "Storage": 1, "EdgeScript": 2, "MagicContainer": 3 }
})

export type BunnyOriginType = typeof BunnyOriginType.Type

export const BunnyShieldDDosProtectionType = _codec({
  ints: [0, 1, 2],
  names: ["DetectOnly", "ActiveStandard", "ActiveAggressive"],
  toName: { 0: "DetectOnly", 1: "ActiveStandard", 2: "ActiveAggressive" },
  toInt: { "DetectOnly": 0, "ActiveStandard": 1, "ActiveAggressive": 2 }
})

export type BunnyShieldDDosProtectionType = typeof BunnyShieldDDosProtectionType.Type

export const BunnyShieldPlan = _codec({
  ints: [0, 1, 2, 3],
  names: ["Basic", "Advanced", "Business", "Enterprise"],
  toName: { 0: "Basic", 1: "Advanced", 2: "Business", 3: "Enterprise" },
  toInt: { "Basic": 0, "Advanced": 1, "Business": 2, "Enterprise": 3 }
})

export type BunnyShieldPlan = typeof BunnyShieldPlan.Type

export const BunnyWafMode = _codec({
  ints: [0, 1],
  names: ["Log", "Block"],
  toName: { 0: "Log", 1: "Block" },
  toInt: { "Log": 0, "Block": 1 }
})

export type BunnyWafMode = typeof BunnyWafMode.Type

export const BunnyDDoSExecutionMode = _codec({
  ints: [0, 1],
  names: ["Log", "Block"],
  toName: { 0: "Log", 1: "Block" },
  toInt: { "Log": 0, "Block": 1 }
})

export type BunnyDDoSExecutionMode = typeof BunnyDDoSExecutionMode.Type

export const BunnyDDoSSensitivity = _codec({
  ints: [0, 1, 2, 3, 4, 5],
  names: ["Off", "Low", "Medium", "High", "Challenge", "ChallengeInteractive"],
  toName: { 0: "Off", 1: "Low", 2: "Medium", 3: "High", 4: "Challenge", 5: "ChallengeInteractive" },
  toInt: { "Off": 0, "Low": 1, "Medium": 2, "High": 3, "Challenge": 4, "ChallengeInteractive": 5 }
})

export type BunnyDDoSSensitivity = typeof BunnyDDoSSensitivity.Type

export const BunnyRateLimitTimeframe = _codec({
  ints: [1, 10, 60, 300, 900, 3600],
  names: ["PerSecond", "PerTenSeconds", "PerOneMinute", "PerFiveMinutes", "PerFifteenMinutes", "PerOneHour"],
  toName: { 1: "PerSecond", 10: "PerTenSeconds", 60: "PerOneMinute", 300: "PerFiveMinutes", 900: "PerFifteenMinutes", 3600: "PerOneHour" },
  toInt: { "PerSecond": 1, "PerTenSeconds": 10, "PerOneMinute": 60, "PerFiveMinutes": 300, "PerFifteenMinutes": 900, "PerOneHour": 3600 }
})

export type BunnyRateLimitTimeframe = typeof BunnyRateLimitTimeframe.Type

export const BunnyRateLimitBlockTime = _codec({
  ints: [30, 60, 300, 900, 1800, 3600],
  names: ["ForThirtySeconds", "ForOneMinute", "ForFiveMinutes", "ForFifteenMinutes", "ForThirtyMinutes", "ForOneHour"],
  toName: { 30: "ForThirtySeconds", 60: "ForOneMinute", 300: "ForFiveMinutes", 900: "ForFifteenMinutes", 1800: "ForThirtyMinutes", 3600: "ForOneHour" },
  toInt: { "ForThirtySeconds": 30, "ForOneMinute": 60, "ForFiveMinutes": 300, "ForFifteenMinutes": 900, "ForThirtyMinutes": 1800, "ForOneHour": 3600 }
})

export type BunnyRateLimitBlockTime = typeof BunnyRateLimitBlockTime.Type

export const BunnyRateLimitCounterKey = _codec({
  ints: [0, 1, 2, 3, 4, 5, 6, 7],
  names: ["IP", "Host", "Country", "City", "ASN", "Organization", "JA4", "IP_JA4"],
  toName: { 0: "IP", 1: "Host", 2: "Country", 3: "City", 4: "ASN", 5: "Organization", 6: "JA4", 7: "IP_JA4" },
  toInt: { "IP": 0, "Host": 1, "Country": 2, "City": 3, "ASN": 4, "Organization": 5, "JA4": 6, "IP_JA4": 7 }
})

export type BunnyRateLimitCounterKey = typeof BunnyRateLimitCounterKey.Type

export const BunnyAccessListType = _codec({
  ints: [0, 1, 2, 3, 4, 5],
  names: ["IP", "CIDR", "ASN", "Country", "Organization", "JA4"],
  toName: { 0: "IP", 1: "CIDR", 2: "ASN", 3: "Country", 4: "Organization", 5: "JA4" },
  toInt: { "IP": 0, "CIDR": 1, "ASN": 2, "Country": 3, "Organization": 4, "JA4": 5 }
})

export type BunnyAccessListType = typeof BunnyAccessListType.Type

export const BunnyAccessListAction = _codec({
  ints: [0, 1, 2, 3, 4, 5],
  names: ["None", "Allow", "Block", "Challenge", "Log", "Bypass"],
  toName: { 0: "None", 1: "Allow", 2: "Block", 3: "Challenge", 4: "Log", 5: "Bypass" },
  toInt: { "None": 0, "Allow": 1, "Block": 2, "Challenge": 3, "Log": 4, "Bypass": 5 }
})

export type BunnyAccessListAction = typeof BunnyAccessListAction.Type

export const BunnyBotDetectionExecutionMode = _codec({
  ints: [0, 1],
  names: ["LogOnly", "Challenge"],
  toName: { 0: "LogOnly", 1: "Challenge" },
  toInt: { "LogOnly": 0, "Challenge": 1 }
})

export type BunnyBotDetectionExecutionMode = typeof BunnyBotDetectionExecutionMode.Type

export const BunnyBotDetectionSensitivity = _codec({
  ints: [0, 1, 2, 3],
  names: ["Off", "Low", "Medium", "High"],
  toName: { 0: "Off", 1: "Low", 2: "Medium", 3: "High" },
  toInt: { "Off": 0, "Low": 1, "Medium": 2, "High": 3 }
})

export type BunnyBotDetectionSensitivity = typeof BunnyBotDetectionSensitivity.Type
