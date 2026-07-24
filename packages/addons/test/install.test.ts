import { assert, it } from "@effect/vitest"
import type { K8sClient, K8sManifest } from "@kumulo/core"
import { Effect } from "effect"
import { installAddons } from "../src/install.ts"
import { resolveAddons } from "../src/registry.ts"

const cloudCredential = {
  provider: "openstack" as const,
  authUrl: "https://auth.cloud.ovh.net/v3",
  region: "GRA",
  applicationCredentialId: "app-id",
  applicationCredentialSecret: "app-secret"
}

// Records the (kind, name) of every applied manifest in call order — enough
// to prove install order without a real k8s server.
const _nameOf = (manifest: K8sManifest): string => {
  const metadata = manifest.metadata
  return typeof metadata === "object" && metadata !== null && "name" in metadata && typeof metadata.name === "string"
    ? metadata.name
    : ""
}

const _fakeK8sClient = (log: Array<string>): K8sClient["Service"] => ({
  get: () => Effect.die("unused"),
  list: () => Effect.die("unused"),
  apply: (_ref, manifest) => {
    log.push(`${manifest.kind}:${_nameOf(manifest)}`)
    return Effect.succeed(manifest)
  },
  delete: () => Effect.die("unused"),
  evict: () => Effect.die("unused")
})

it.effect("installs addon manifests in registry order, addon-by-addon", () =>
  Effect.gen(function*() {
    const log: Array<string> = []
    const addons = resolveAddons({
      distro: "k3s",
      addons: {
        cloud_controller_manager: true,
        cinder_csi: { enabled: true, default_volume_type: "classic" },
        hcloud_csi: { enabled: false },
        system_upgrade_controller: true,
        cni: "cilium"
      },
      capabilities: ["cilium"],
      cloudCredential
    })

    yield* installAddons({ k8sClient: _fakeK8sClient(log), addons, ctx: { clusterName: "test", capabilities: ["cilium"] } })

    // cilium's manifests land fully before openstack-ccm's, whose Secret
    // lands before cinder-csi's (shared name, re-applied — SSA is
    // idempotent), and system-upgrade-controller lands last.
    assert.deepStrictEqual(log, [
      "ServiceAccount:cilium",
      "DaemonSet:cilium",
      "Secret:cloud-config",
      "ServiceAccount:openstack-cloud-controller-manager",
      "ClusterRoleBinding:system:openstack-cloud-controller-manager",
      "DaemonSet:openstack-cloud-controller-manager",
      "Secret:cloud-config",
      "ServiceAccount:cinder-csi-controller-sa",
      "Deployment:csi-cinder-controllerplugin",
      "StorageClass:cinder-csi",
      "Namespace:system-upgrade",
      "ServiceAccount:system-upgrade-controller",
      "ClusterRoleBinding:system-upgrade-controller",
      "Deployment:system-upgrade-controller"
    ])
  }))
