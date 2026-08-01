// auth wiring deliberately not done here (dependency-cruiser sibling-import rule), composed at the CLI layer
export { make as makeStorageClient } from "../generated/client.ts"
export type { Storage, StorageError } from "../generated/client.ts"
