#!/usr/bin/env bun
// Regenerates src/releases/fixture.ts from the live rancher/k3s GitHub tags —
// run manually (`bun run scripts/refresh-releases.ts`), never in CI/tests
// (tests must stay offline): a one-shot, human-triggered refresh.
import { Effect, Schema } from "effect"

const Tags = Schema.Array(Schema.Struct({ name: Schema.String }))

const res = await fetch("https://api.github.com/repos/k3s-io/k3s/tags?per_page=8")
const tags = await Effect.runPromise(Schema.decodeUnknownEffect(Tags)(await res.json()))
const names = tags.map((tag) => `  "${tag.name}"`).join(",\n")

console.log(`export const K3S_RELEASE_FIXTURE: ReadonlyArray<string> = [\n${names}\n]\n`)

console.log("// paste the above into src/releases/fixture.ts")
