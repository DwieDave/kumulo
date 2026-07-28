import { Effect, Layer } from "effect"
import { CloudProvider } from "@kumulo/core"
import type { LbSpec, NetworkInfo, NetworkSpec } from "@kumulo/core"

export const defaultNetworkInfo: NetworkInfo = {
  id: "net-1",
  cidr: "10.0.0.0/16",
  nodesSubnetId: "subnet-nodes-1",
  loadBalancersSubnetId: "subnet-lb-1"
}

/**
 * A `CloudProvider` the MKS path may only ever call `ensureNetwork` on — every
 * other verb dies rather than returning a plausible value, so a reconciler that
 * starts creating servers or security groups on this path fails the test that
 * happened to run it instead of quietly passing.
 *
 * `specs` records what `ensureNetwork` was asked for, in order; an empty array
 * is the assertion that no network was touched at all.
 */
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

/** The common case: a `CloudProvider` no test in this file expects to be reached. */
export const cloudProviderNever: Layer.Layer<CloudProvider> = fakeCloudProvider().layer
