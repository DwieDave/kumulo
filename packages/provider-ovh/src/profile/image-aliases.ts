// Design §3.2 — friendly image aliases resolved to OVH's exact Glance
// image names, which are region-scoped (a name available in one region
// isn't guaranteed to exist verbatim in another). Falls back to the same
// name across all known regions today (ponytail: flat table; split a
// region out only once its Glance catalog is confirmed to diverge).
const commonAliases: Record<string, string> = {
  "ubuntu-24.04": "Ubuntu 24.04",
  "ubuntu-22.04": "Ubuntu 22.04",
  "debian-12": "Debian 12"
}

export const imageAliasesForRegion = (_region: string): Record<string, string> => commonAliases
