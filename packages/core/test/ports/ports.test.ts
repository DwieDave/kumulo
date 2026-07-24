// Proves each port is a usable Effect service: a fake implementation can be
// built and provided as a Layer, and a consumer can resolve + call it. This
// is the compile+runtime proof that the interfaces in src/ports are honest
// contracts, not just types.
import { describe, expect, it } from "@effect/vitest"
import { Effect, Layer } from "effect"
import { CloudProvider } from "../../src/ports/cloud-provider.ts"
import { ProviderProfile } from "../../src/ports/provider-profile.ts"
import { Distro } from "../../src/ports/distro.ts"
import { Addon } from "../../src/ports/addon.ts"
import { DnsProvider } from "../../src/ports/dns-provider.ts"
import { VolumeProvider } from "../../src/ports/volume-provider.ts"

describe("ports", () => {
  it.effect("CloudProvider resolves through a fake Layer", () =>
    Effect.gen(function*() {
      const fake = Layer.succeed(
        CloudProvider,
        CloudProvider.of({
          ensureNetwork: () => Effect.succeed({ id: "net-1", cidr: "10.0.0.0/16" }),
          ensureSecurityGroups: () => Effect.succeed({ id: "sg-1" }),
          ensureLoadBalancer: () => Effect.succeed({ id: "lb-1", vip: "1.2.3.4" }),
          ensureServer: () => Effect.succeed({ id: "srv-1", name: "master-1", ip: "10.0.0.2" }),
          deleteServer: () => Effect.void,
          deleteByTag: () => Effect.void,
          listClusterResources: () =>
            Effect.succeed({ servers: [], networks: [], securityGroups: [], loadBalancers: [] }),
          resolveImage: () => Effect.succeed("img-1"),
          resolveFlavor: () => Effect.succeed("flavor-1")
        })
      )
      const result = yield* Effect.provide(
        CloudProvider.pipe(Effect.flatMap((cp) => cp.resolveImage("ubuntu-24.04"))),
        fake
      )
      expect(result).toBe("img-1")
    }))

  it.effect("ProviderProfile resolves through a fake Layer", () =>
    Effect.gen(function*() {
      const fake = Layer.succeed(
        ProviderProfile,
        ProviderProfile.of({
          name: "ovh",
          auth: { keystoneUrlPattern: "https://auth.cloud.ovh.net/v3", domainDefault: "Default" },
          capabilities: { octavia: () => true, floatingIps: false, volumeTypes: ["classic"] },
          defaults: { externalNetworkName: "Ext-Net", imageAliases: {}, dnsServers: [] },
          validate: () => Effect.void
        })
      )
      const name = yield* Effect.provide(
        ProviderProfile.pipe(Effect.map((profile) => profile.name)),
        fake
      )
      expect(name).toBe("ovh")
    }))

  it.effect("Distro resolves a managed implementation and branches on kind", () =>
    Effect.gen(function*() {
      const fake = Layer.succeed(
        Distro,
        Distro.of({
          kind: "managed",
          name: "ovh-mks",
          ensureCluster: () => Effect.succeed({ id: "c-1", apiEndpoint: "https://api", status: "READY" }),
          ensureNodePools: () => Effect.void,
          fetchKubeconfig: () => Effect.succeed({ content: "kubeconfig" }),
          upgrade: () => Effect.void,
          delete: () => Effect.void
        })
      )
      const kind = yield* Effect.provide(Distro.pipe(Effect.map((d) => d.kind)), fake)
      expect(kind).toBe("managed")
    }))

  it.effect("Addon resolves through a fake Layer", () =>
    Effect.gen(function*() {
      const fake = Layer.succeed(
        Addon,
        Addon.of({
          name: "cilium",
          requiredCapabilities: [],
          manifests: () => Effect.succeed([])
        })
      )
      const name = yield* Effect.provide(Addon.pipe(Effect.map((a) => a.name)), fake)
      expect(name).toBe("cilium")
    }))

  it.effect("DnsProvider resolves through a fake Layer", () =>
    Effect.gen(function*() {
      const fake = Layer.succeed(
        DnsProvider,
        DnsProvider.of({
          ensureRecords: () => Effect.void,
          removeClusterRecords: () => Effect.void
        })
      )
      yield* Effect.provide(
        DnsProvider.pipe(Effect.flatMap((dns) => dns.ensureRecords("example.com", []))),
        fake
      )
      expect(true).toBe(true)
    }))

  it.effect("VolumeProvider resolves through a fake Layer", () =>
    Effect.gen(function*() {
      const fake = Layer.succeed(
        VolumeProvider,
        VolumeProvider.of({
          ensureVolume: (spec) => Effect.succeed({ id: "vol-1", name: spec.name }),
          listClusterVolumes: () => Effect.succeed([]),
          deleteVolume: () => Effect.void,
          staticPvManifest: () => ({ apiVersion: "v1", kind: "PersistentVolume" })
        })
      )
      const info = yield* Effect.provide(
        VolumeProvider.pipe(
          Effect.flatMap((vp) => vp.ensureVolume({ name: "postgres-data", sizeGb: 100, type: "high-speed", retain: true }))
        ),
        fake
      )
      expect(info.name).toBe("postgres-data")
    }))
})
