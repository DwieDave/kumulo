import { Effect } from "effect"
import { assert, it } from "@effect/vitest"
import { makeStorageClient } from "@kumulo/upcloud"
import { deleteVolume, ensureVolume, listClusterVolumes } from "../src/provider.ts"
import { makeFakeStorageServer } from "./fake-storage-server.ts"

const _options = { tag: "demo-cluster", zone: "de-fra1" } as const
const _spec = { name: "data", sizeGb: 25, type: "maxiops", retain: false } as const

it.effect("ensureVolume creates and returns the uuid as id once the storage is online", () =>
  Effect.gen(function*() {
    const { httpClient } = makeFakeStorageServer({ readyAfterPolls: 0 })
    const client = makeStorageClient(httpClient)
    const info = yield* ensureVolume({ client, options: _options, spec: _spec })
    assert.strictEqual(info.name, "data")
    assert.match(info.id, /^storage-/)
  }))

it.effect("ensureVolume is idempotent: a second call finds the same labeled storage instead of creating another", () =>
  Effect.gen(function*() {
    const { httpClient, storages } = makeFakeStorageServer({ readyAfterPolls: 0 })
    const client = makeStorageClient(httpClient)
    const first = yield* ensureVolume({ client, options: _options, spec: _spec })
    const second = yield* ensureVolume({ client, options: _options, spec: _spec })
    assert.strictEqual(first.id, second.id)
    assert.strictEqual(storages.size, 1)
  }))

it.effect("ensureVolume for a different cluster tag creates a separate storage despite the same name", () =>
  Effect.gen(function*() {
    const { httpClient, storages } = makeFakeStorageServer({ readyAfterPolls: 0 })
    const client = makeStorageClient(httpClient)
    yield* ensureVolume({ client, options: _options, spec: _spec })
    yield* ensureVolume({ client, options: { tag: "other-cluster", zone: "de-fra1" }, spec: _spec })
    assert.strictEqual(storages.size, 2)
  }))

it.effect("listClusterVolumes only returns storages labeled for the given cluster tag", () =>
  Effect.gen(function*() {
    const { httpClient } = makeFakeStorageServer({ readyAfterPolls: 0 })
    const client = makeStorageClient(httpClient)
    yield* ensureVolume({ client, options: _options, spec: _spec })
    yield* ensureVolume({ client, options: { tag: "other-cluster", zone: "de-fra1" }, spec: _spec })
    const list = yield* listClusterVolumes({ client, tag: _options.tag })
    assert.strictEqual(list.length, 1)
  }))

it.effect("deleteVolume of an already-gone storage succeeds", () =>
  Effect.gen(function*() {
    const { httpClient } = makeFakeStorageServer()
    const client = makeStorageClient(httpClient)
    yield* deleteVolume({ client, ref: { id: "storage-999" } })
  }))

it.effect("deleteVolume of an attached storage surfaces ResourceConflict, never force-detaches", () =>
  Effect.gen(function*() {
    const { httpClient, markAttached } = makeFakeStorageServer({ readyAfterPolls: 0 })
    const client = makeStorageClient(httpClient)
    const info = yield* ensureVolume({ client, options: _options, spec: _spec })
    markAttached(info.id)
    const failure = yield* Effect.flip(deleteVolume({ client, ref: { id: info.id } }))
    assert.strictEqual(failure._tag, "ResourceConflict")
  }))
