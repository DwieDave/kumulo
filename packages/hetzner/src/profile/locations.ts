// kumulo: Hetzner Cloud's 6 locations and their network zones (D2/D8) — verified
// against Hetzner's published locations doc (docs.hetzner.com/cloud/general/locations),
// current as of 2026-07. Network zone constrains which locations a `Network`'s
// subnets can span; a location outside this table has no zone to derive.
export const hetznerLocationZones: Readonly<Record<string, string>> = {
  fsn1: "eu-central",
  nbg1: "eu-central",
  hel1: "eu-central",
  ash: "us-east",
  hil: "us-west",
  sin: "ap-southeast"
}

export const hetznerLocations: ReadonlyArray<string> = Object.keys(hetznerLocationZones)

export const isHetznerLocation = (location: string): boolean => location in hetznerLocationZones

/** Network zone a location's resources live in — `undefined` for an unknown location. */
export const networkZoneForLocation = (location: string): string | undefined => hetznerLocationZones[location]
