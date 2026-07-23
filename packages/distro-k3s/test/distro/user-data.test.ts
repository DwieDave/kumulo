import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import { renderUserData } from "../../src/distro/user-data.ts"

// FR-2.1 — per-node hostname must be unique (k3s derives node names from
// the hostname); a template keyed only on cluster name + role collides
// across every master/every worker of a role.
describe("renderUserData", () => {
  it.effect("uses the node's own name, not a role-wide template", () =>
    Effect.gen(function*() {
      const render = renderUserData({ clusterName: "demo", sshPublicKey: "ssh-ed25519 AAAA..." })
      const master1 = yield* render("master", { name: "master-1", role: "master", apiEndpoint: "1.2.3.4" })
      const master2 = yield* render("master", { name: "master-2", role: "master", apiEndpoint: "1.2.3.4" })
      expect(master1).toContain("hostname: master-1")
      expect(master2).toContain("hostname: master-2")
      expect(master1).not.toEqual(master2)
    }))
})
