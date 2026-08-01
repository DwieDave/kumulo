// flat table across regions; split one out once its Glance catalog is confirmed to diverge
const commonAliases: Record<string, string> = {
  "ubuntu-24.04": "Ubuntu 24.04",
  "ubuntu-22.04": "Ubuntu 22.04",
  "debian-12": "Debian 12"
}

export const imageAliasesForRegion = (_region: string): Record<string, string> => commonAliases
