import { Effect } from "effect"
import { assert, it } from "@effect/vitest"
import { parseConfigYaml } from "@kumulo/core"
import { reconcileVolumesOnDelete } from "../../src/commands/volumes.ts"
import { makeFakeCinder } from "./fake-cinder.ts"

const _yaml = `
name: staging
provider: ovh
distro: ovh-mks
version: "1.31.0"
auth:
  method: application_credential
  region: GRA5
network:
  cidr: 10.0.0.0/16
  public_access: nat
api_server:
  high_availability: true
  allowed_cidrs: ["0.0.0.0/0"]
ssh:
  public_key_path: ~/.ssh/id_ed25519.pub
  allowed_cidrs: ["0.0.0.0/0"]
masters:
  flavor: b2-7
  count: 3
  image: ubuntu-22.04
worker_pools: []
dns:
  module: none
  zone: unused.example.com
  ttl: 300
  records: []
volumes:
  module: cinder
  retained:
    - name: keep-me
      size_gb: 50
      type: high-speed
      retain: true
    - name: drop-me
      size_gb: 10
      type: classic
      retain: false
addons:
  cloud_controller_manager: true
  cinder_csi:
    enabled: true
    default_volume_type: high-speed
  system_upgrade_controller: false
  cni: flannel
k3s:
  extra_server_args: []
  extra_agent_args: []
`

// AC-7 — `delete` retains `retain: true` volumes and prints what it kept;
// non-retained entries recorded in config are actually deleted.
it.effect("keeps retain:true volumes and deletes the rest", () =>
  Effect.gen(function*() {
    const config = yield* parseConfigYaml(_yaml)
    const deletedIds: Array<string> = []
    const fakeCinder = makeFakeCinder({
      "GET /volumes/detail": () => ({
        status: 200,
        body: {
          volumes: [
            { id: "vol-keep", name: "keep-me", metadata: { kumulo_cluster: "staging" } },
            { id: "vol-drop", name: "drop-me", metadata: { kumulo_cluster: "staging" } }
          ]
        }
      }),
      "DELETE /volumes/vol-drop": () => {
        deletedIds.push("vol-drop")
        return { status: 204 }
      }
    })

    const kept = yield* reconcileVolumesOnDelete(config).pipe(Effect.provide(fakeCinder))

    assert.deepStrictEqual(kept, ["keep-me"])
    assert.deepStrictEqual(deletedIds, ["vol-drop"])
  }))

it.effect("no-ops when volumes.module isn't cinder", () =>
  Effect.gen(function*() {
    const config = yield* parseConfigYaml(_yaml.replace("module: cinder", "module: none"))
    const fakeCinder = makeFakeCinder({})
    const kept = yield* reconcileVolumesOnDelete(config).pipe(Effect.provide(fakeCinder))
    assert.deepStrictEqual(kept, [])
  }))
