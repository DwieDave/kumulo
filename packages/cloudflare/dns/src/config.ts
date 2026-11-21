import { crossFieldRule } from "@kumulo/core"

const _isCloudflareTtl = (ttl: number): boolean => ttl === 1 || (ttl >= 60 && ttl <= 86400)

// 1 is Cloudflare's "automatic". Enterprise zones accept 30 and up; kumulo keeps the 60 every plan allows.
export const cloudflareTtlRange = crossFieldRule({
  check: (config: { dns: { module: string; ttl?: number } }) =>
    config.dns.module === "cloudflare" && config.dns.ttl !== undefined && !_isCloudflareTtl(config.dns.ttl)
      ? "Cloudflare requires dns.ttl to be 1 (automatic) or between 60 and 86400"
      : undefined,
  jsonSchema: [
    {
      if: {
        properties: { dns: { properties: { module: { const: "cloudflare" } }, required: ["module"] } },
        required: ["dns"]
      },
      then: {
        properties: { dns: { properties: { ttl: { anyOf: [{ const: 1 }, { minimum: 60, maximum: 86400 }] } } } }
      }
    }
  ]
})

export const cloudflareConfigRules = [cloudflareTtlRange]
