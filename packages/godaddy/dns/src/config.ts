import { crossFieldRule, isIpLiteral } from "@kumulo/core"

const _reservedDnsTargets = ["api_server", "ingress", "cdn"]

export const godaddyTtlMinimum = crossFieldRule({
  check: (config: { dns: { module: string; ttl?: number } }) =>
    config.dns.module === "godaddy" && config.dns.ttl !== undefined && config.dns.ttl < 600
      ? "GoDaddy requires dns.ttl >= 600"
      : undefined,
  jsonSchema: [
    {
      if: {
        properties: { dns: { properties: { module: { const: "godaddy" } }, required: ["module"] } },
        required: ["dns"]
      },
      then: { properties: { dns: { properties: { ttl: { minimum: 600 } } } } }
    }
  ]
})

// JSON Schema cannot compare record.name to dns.zone, so this rule has no rendering
export const godaddyApexNotCname = crossFieldRule({
  check: (config: { dns: { module: string; zone?: string; records?: ReadonlyArray<{ name: string; target: string }> } }) =>
    config.dns.module === "godaddy" &&
    config.dns.records?.some(
      (record) =>
        (record.name === "@" || record.name === config.dns.zone) &&
        !_reservedDnsTargets.includes(record.target) &&
        !isIpLiteral(record.target)
    ) === true
      ? "GoDaddy rejects an apex CNAME: dns.records at the zone apex must target an IP address"
      : undefined,
  jsonSchema: []
})

export const godaddyConfigRules = [godaddyTtlMinimum, godaddyApexNotCname]
