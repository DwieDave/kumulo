// Design §3.2 — Octavia (OVH's managed load balancer) is not available in
// every OVH Public Cloud region. This table is best-effort from OVH's
// published region capability matrix at time of writing; extend as OVH
// rolls Octavia out further (ponytail: flat data table, revisit if OVH
// exposes a live capability-discovery API worth calling instead).
export const octaviaRegions: ReadonlySet<string> = new Set([
  "GRA5",
  "GRA7",
  "GRA9",
  "GRA11",
  "SBG5",
  "SBG7",
  "DE1",
  "UK1",
  "WAW1"
])

export const hasOctavia = (region: string): boolean => octaviaRegions.has(region)
