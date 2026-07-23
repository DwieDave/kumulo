import { assert, it } from "@effect/vitest"
import { AuthenticationFailed, ResourceNotFound } from "@kumulo/core"
import { DistroNotWired } from "../src/distro-not-wired.ts"
import { renderCliError } from "../src/errors.ts"

it("renders a core KumuloError via the shared registry", () => {
  const message = renderCliError(new AuthenticationFailed({ hint: "bad token" }))
  assert.match(message, /Authentication failed: bad token/)
})

it("renders ResourceNotFound", () => {
  const message = renderCliError(new ResourceNotFound({ kind: "kube", ref: "prod-eu" }))
  assert.match(message, /kube not found: prod-eu/)
})

it("renders a CLI-only DistroNotWired error", () => {
  const message = renderCliError(new DistroNotWired({ distro: "k3s" }))
  assert.match(message, /k3s.*not wired/)
})
