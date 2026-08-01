import { Effect, Layer } from "effect"
import { CloudProvider } from "@kumulo/core"
import type { LbSpec, NetworkInfo, NetworkSpec } from "@kumulo/core"

export const defaultNetworkInfo: NetworkInfo = {
  id: "net-1",
  cidr: "10.0.0.0/16",
  nodesSubnetId: "subnet-nodes-1",
  loadBalancersSubnetId: "subnet-lb-1"
}

const _unused = () => Effect.die("the mks path must not reach this CloudProvider verb")

export const defaultLbInfo = { id: "lb-1", vip: "10.0.2.7", floatingIp: "203.0.113.1" }

export const fakeCloudProvider = (info: NetworkInfo = defaultNetworkInfo) => {
  const specs: Array<NetworkSpec> = []
  const lbSpecs: Array<LbSpec> = []
  const layer = Layer.succeed(CloudProvider, {
    ensureNetwork: (spec: NetworkSpec) => {
      specs.push(spec)
      return Effect.succeed(info)
    },
    findNetwork: (_spec: NetworkSpec) => Effect.succeed(info),
    hasGateway: () => Effect.succeed(false),
    ensureLoadBalancer: (spec: LbSpec) => {
      lbSpecs.push(spec)
      return Effect.succeed(defaultLbInfo)
    },
    ensureSecurityGroups: _unused,
    ensureServer: _unused,
    deleteServer: _unused,
    deleteByTag: _unused,
    listClusterResources: _unused,
    resolveImage: _unused,
    resolveFlavor: _unused
  })
  return { layer, specs, lbSpecs }
}

export const cloudProviderNever: Layer.Layer<CloudProvider> = fakeCloudProvider().layer
