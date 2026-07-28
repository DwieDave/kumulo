# Scope: MKS private network + ingress load balancer

## In scope

1. **Network creation.** `NetworkSpec`/`NetworkInfo`
   (`packages/core/src/domain/types.ts:13-19`) grow from one CIDR in / network
   id out to two configurable subnet CIDRs in, network id + both subnet ids out.
   `ensureNetwork` (`packages/openstack/src/provider/cloud-provider.ts:105`)
   creates both subnets.

   ```yaml
   network:
     cidr: 10.0.0.0/16
     nodes_subnet: 10.0.1.0/24
     load_balancers_subnet: 10.0.2.0/24
   ```

2. **`ensureNetwork` re-read fix.** The existing-network path early-returns
   `{ id, cidr }` at `cloud-provider.ts:113` without ever reading the network's
   subnets. Harmless today because `NetworkInfo` has no subnet ids; a
   correctness bug the moment it does, hit on every re-apply.

3. **MKS network wiring.** `network` block on `MksClusterConfig`;
   `loadBalancersSubnetId` added to the distro-layer `MksClusterConfig`
   (`packages/distro-ovh-mks/src/distro/types.ts:29`, distinct from core's
   config-schema type of the same name) alongside the existing
   `privateNetworkId`/`nodesSubnetId`; all three populated in
   `ensure-cluster.ts`'s creation payload from the created network.

4. **Floating IP.** Allocate, associate to a load balancer's `vip_port_id`, and
   release. New code in `packages/openstack`, using the already-generated
   Neutron client (`packages/openstack/src/generated/neutron.ts`).

5. **Ingress load balancer.** `ensureLoadBalancer` gains VIP subnet/network
   placement and a flavor, and returns `{ id, vip, floatingIp }`. An
   `octaviaEnabled` source that works for MKS. An `ingress` config block, a
   reconcile phase, and LB id + floating IP in `<cluster>.outputs.yaml`.

6. **`ingress` DNS target.** `_resolveTarget` (`packages/cli/src/dns.ts:17`)
   generalises from a single scalar `apiTarget` to a target→value resolution
   covering both `api_server` and `ingress`. Plan rows
   (`packages/cli/src/dns-plan.ts`) stay honest when the LB does not exist yet.

7. **Lifecycle semantics.** Plan rows for network/LB/floating IP; teardown
   ordering; loud plan-time failure when a config's network identity differs
   from the live cluster (unappliable — see intent).

## Out of scope (YAGNI)

1. **Managing the ingress controller.** kumulo creates the LB and publishes its
   id. Annotating a Kubernetes Service to adopt it belongs to whatever renders
   that Service — in the consuming repo, konfig.ts.

2. **Listeners, pools, members, health monitors.** The CCM owns them once a
   Service adopts the LB. kumulo must not create, prune or diff them. The
   existing "`spec.members` is deliberately not sent" note
   (`cloud-provider.ts:224`) is promoted from an implementation aside to a
   contract.

3. **vRack creation.** A vRack is per-project account setup, not per-cluster.
   kumulo checks for it and fails with an actionable message; it does not
   create one.

4. **Multiple ingress LBs / multiple floating IPs per cluster.** One ingress LB,
   one floating IP. The config shape should not preclude more later, but nothing
   is built for it.

5. **`target: ingress` on the k3s distro.** k3s has its own LB story for the API
   VIP. This work must not regress it, but does not extend it.

6. **Internal / private-only load balancers.** Upstream forbids internal
   Services sharing a LB anyway. Public ingress only.

7. **IPv6.** Neutron subnet creation stays `ip_version: 4`, as today.

8. **Retaining the network across a delete.** The network is fully reproducible
   from `cluster.json`, so it is deleted with the cluster — a deliberate
   contrast with volumes and buckets, which hold unregenerable state and
   therefore carry `retain`.

9. **Migrating an existing cluster onto a private network.** Impossible by
   construction: MKS networking is creation-time only. In scope is *failing
   clearly*, not migrating.
