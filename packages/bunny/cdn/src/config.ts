import { crossFieldRule } from "@kumulo/core"

export const cdnApexRequiresBunnyDns = crossFieldRule({
  check: (config: { dns: { module: string; zone?: string }; cdn?: { module: string; hostnames?: ReadonlyArray<string> } }) => {
    const zone = "zone" in config.dns ? config.dns.zone : undefined

    // none's zone only names the records the operator enters by hand; kumulo writes no apex record for it
    return config.cdn?.hostnames?.some((host) => host === zone) === true && config.dns.module !== "bunny" && config.dns.module !== "none"
      ? "cdn.hostnames contains the dns.zone apex, which requires dns.module bunny"
      : undefined
  },
  jsonSchema: []
})

export const bunnyCdnConfigRules = [cdnApexRequiresBunnyDns]
