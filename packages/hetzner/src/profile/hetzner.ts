import { Layer } from "effect"
import { ProviderProfile } from "@kumulo/core"
import { validateHetznerConfig } from "./validation.ts"

// kumulo: Hetzner's Load Balancer product is broadly available across all 6
// locations (unlike OVH's per-region Octavia) — collapses to always-true
// pending the per-location verification flagged in plan.md T3.1; revisit if
// Hetzner ever ships a location without it.
const _hasLoadBalancer = (_location: string): boolean => true

// kumulo: `ProviderProfile` port: data + small logic parameterizing the
// Hetzner implementation, never makes HTTP calls itself (mirrors provider-ovh's
// `makeOvhProfile`/`ovhProfileLive` shape).
export const makeHetznerProfile = () => ({
  name: "hetzner",
  auth: {
    // kumulo: Hetzner has no Keystone-style identity service — these fields
    // are OpenStack-shaped port leftovers unused on this path (never read
    // by the Hetzner CloudProvider impl).
    keystoneUrlPattern: "",
    domainDefault: ""
  },
  capabilities: {
    octavia: _hasLoadBalancer,
    floatingIps: false,
    // kumulo: Hetzner has one flat volume product (D3) — no per-type
    // allowlist to enforce, unlike OVH's classic/high-speed/high-speed-gen2.
    volumeTypes: ["default"]
  },
  defaults: {
    // kumulo: D6(a) — Hetzner servers get public IPv4 directly, no Neutron
    // ext-net equivalent; degenerate value, nothing reads it on this path.
    externalNetworkName: "",
    // kumulo: Hetzner's own system-image names (e.g. "ubuntu-24.04") already
    // match the conventional aliases callers use — no translation table needed
    // (unlike OVH's "Ubuntu 24.04" display-name mismatch).
    imageAliases: {},
    dnsServers: ["185.12.64.1", "185.12.64.2"]
  },
  validate: validateHetznerConfig
})

export const hetznerProfileLive = Layer.succeed(ProviderProfile, makeHetznerProfile())
