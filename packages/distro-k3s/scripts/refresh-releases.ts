#!/usr/bin/env bun
// Regenerates src/releases/fixture.ts from the live rancher/k3s GitHub tags —
// run manually (`bun run scripts/refresh-releases.ts`), never in CI/tests
// (offline requirement, FR-5.6). Mirrors the `@effect/openapi-generator`
// specs-update-script precedent: a one-shot, human-triggered refresh.
const _isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null

const _tagName = (value: unknown): string | undefined => {
  if (!_isRecord(value)) return undefined
  return typeof value["name"] === "string" ? value["name"] : undefined
}

const res = await fetch("https://api.github.com/repos/k3s-io/k3s/tags?per_page=8")
const body: unknown = await res.json()
const names = (Array.isArray(body) ? body : []).flatMap((tag) => {
  const name = _tagName(tag)
  return name === undefined ? [] : [`  "${name}"`]
}).join(",\n")
console.log(`export const K3S_RELEASE_FIXTURE: ReadonlyArray<string> = [\n${names}\n]\n`)
console.log("// paste the above into src/releases/fixture.ts")
