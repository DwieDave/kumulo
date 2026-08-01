// flat data table from OVH's region capability matrix, revisit if a live discovery API shows up
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
