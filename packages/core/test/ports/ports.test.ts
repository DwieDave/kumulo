// Proves each port is a usable Effect service: a fake implementation can be
// built and provided as a Layer, and a consumer can resolve + call it. This
// is the compile+runtime proof that the interfaces in src/ports are honest
// contracts, not just types.
import { describe, expect, it } from "@effect/vitest"
import { Effect, Layer, Redacted } from "effect"
import { CloudProvider } from "../../src/ports/cloud-provider.ts"
import { CredentialsSink } from "../../src/ports/credentials-sink.ts"
import { ProviderProfile } from "../../src/ports/provider-profile.ts"
import { Distro } from "../../src/ports/distro.ts"
import { Addon } from "../../src/ports/addon.ts"
import { DnsProvider } from "../../src/ports/dns-provider.ts"
import { ObjectStorageProvider } from "../../src/ports/object-storage-provider.ts"
import { VolumeProvider } from "../../src/ports/volume-provider.ts"

describe("ports", () => {
  it.effect("CloudProvider resolves through a fake Layer", () =>
    Effect.gen(function*() {
      const fake = Layer.succeed(
        CloudProvider,
        CloudProvider.of({
          ensureNetwork: (spec) =>
            Effect.succeed({
              id: "net-1",
              cidr: spec.cidr,
              nodesSubnetId: `nodes-${spec.nodesSubnet}`,
              loadBalancersSubnetId: `lb-${spec.loadBalancersSubnet}`
            }),
          findNetwork: (spec) =>
            Effect.succeed({
              id: "net-1",
              cidr: spec.cidr,
              nodesSubnetId: `nodes-${spec.nodesSubnet}`,
              loadBalancersSubnetId: `lb-${spec.loadBalancersSubnet}`
            }),
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
      // Both subnet CIDRs go in, both subnet ids come back out.
      const network = yield* Effect.provide(
        CloudProvider.pipe(
          Effect.flatMap((cp) =>
            cp.ensureNetwork({ cidr: "10.0.0.0/16", nodesSubnet: "10.0.1.0/24", loadBalancersSubnet: "10.0.2.0/24" })
          )
        ),
        fake
      )
      expect(network).toEqual({
        id: "net-1",
        cidr: "10.0.0.0/16",
        nodesSubnetId: "nodes-10.0.1.0/24",
        loadBalancersSubnetId: "lb-10.0.2.0/24"
      })
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

  it.effect("ObjectStorageProvider resolves through a fake Layer", () =>
    Effect.gen(function*() {
      const fake = Layer.succeed(
        ObjectStorageProvider,
        ObjectStorageProvider.of({
          listBuckets: () => Effect.succeed([]),
          ensureBucket: (spec) => Effect.succeed({ name: spec.name, region: spec.region, endpoint: "s3.gra.io.cloud.ovh.net" }),
          deleteBucket: () => Effect.void,
          ensureCredentials: (clusterName) =>
            Effect.succeed({
              user: `kumulo-${clusterName}`,
              accessKey: Redacted.make("access"),
              secretKey: Redacted.make("secret"),
              buckets: []
            })
        })
      )
      const bucket = yield* Effect.provide(
        ObjectStorageProvider.pipe(
          Effect.flatMap((osp) =>
            osp.ensureBucket({ name: "staging-eu-backups", region: "DE1", versioning: false, encryption: false, retain: true })
          )
        ),
        fake
      )
      expect(bucket.name).toBe("staging-eu-backups")
    }))

  it.effect("CredentialsSink resolves through a fake Layer", () =>
    Effect.gen(function*() {
      const fake = Layer.succeed(
        CredentialsSink,
        CredentialsSink.of({
          write: () => Effect.void
        })
      )
      yield* Effect.provide(
        CredentialsSink.pipe(
          Effect.flatMap((sink) => sink.write([{ key: "s3.accessKey", value: Redacted.make("access") }]))
        ),
        fake
      )
      expect(true).toBe(true)
    }))
})
