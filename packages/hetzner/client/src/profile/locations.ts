export const hetznerLocationZones = {
  fsn1: "eu-central",
  nbg1: "eu-central",
  hel1: "eu-central",
  ash: "us-east",
  hil: "us-west",
  sin: "ap-southeast"
} as const satisfies Readonly<Record<string, string>>

export const hetznerLocations: ReadonlyArray<string> = Object.keys(hetznerLocationZones)

export const isHetznerLocation = (location: string): boolean => Object.hasOwn(hetznerLocationZones, location)

export const networkZoneForLocation = (location: string): string | undefined => Object.entries(hetznerLocationZones).find(([name]) => name === location)?.[1]
