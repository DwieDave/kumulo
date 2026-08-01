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

export const networkZoneForLocation = (location: string): string | undefined => hetznerLocationZones[location]
