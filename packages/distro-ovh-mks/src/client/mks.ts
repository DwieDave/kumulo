// no @kumulo/provider-ovh import here — dependency-cruiser's no-sibling-package-imports enforces the hexagonal boundary
export { make as makeMksClient } from "../generated/client.ts"
export type { Mks, MksError } from "../generated/client.ts"
