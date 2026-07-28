# Intent

Let an `ovh-mks` cluster be provisioned onto a private network it owns, front its
workloads with a load balancer kumulo creates, and point DNS at that load
balancer — all from `cluster.json`, in one `apply`.

Three gaps stand between today's MKS support and that.

**MKS clusters have no network.** `MksClusterConfig`
(`packages/core/src/config/schema.ts`) carries no `network` block at all, so
every MKS cluster lands on OVH's default public addressing. The distro layer is
already half-wired for the alternative — the distro-layer `MksClusterConfig`
declares `privateNetworkId` and `nodesSubnetId`
(`packages/distro-ovh-mks/src/distro/types.ts:29`)
and `ensure-cluster.ts:65-66` passes them into the creation payload — but
nothing ever populates them, as `cluster-drift.ts:15` says outright:
*"`privateNetworkId`/`nodesSubnetId` are never set by the CLI"*.

**The load balancer we can build isn't the one ingress needs.**
`ensureLoadBalancer` (`packages/openstack/src/provider/cloud-provider.ts:208`)
posts `{loadbalancer:{name}}` and returns `vip_address` — an internal VIP, on
whatever subnet Octavia picks. There is no floating-IP code anywhere in
`packages/openstack`, so nothing it produces is reachable from the internet.
It is also gated on `octaviaEnabled`, which is derived from
`config.api_server.high_availability`
(`packages/cli/src/provider/registry.ts:31`) — a field MKS configs do not have.

**`target: ingress` silently lies.** `DesiredRecord.target` is typed
`"api_server" | "ingress" | string` (`packages/core/src/domain/types.ts:129`),
but `_resolveTarget` (`packages/cli/src/dns.ts:17`) substitutes `api_server` and
nothing else. A record written as `target: ingress` therefore reconciles to a
record whose *value* is the literal string `ingress`. `.docs/workflows/mks-hetzner-dns/scope.md`
put ingress records for MKS out of scope on the grounds that "OVH client
surfaces no node IPs today"; a kumulo-owned load balancer removes that
objection, because the address is one kumulo allocated rather than one it has to
discover.

## Why now

The `app-cluster` repo is migrating off `hetzner-k3s` onto OVH MKS. Its CI
currently hand-rolls the same three concerns in ~300 lines of bash — creating
volumes with `curl`, deriving DNS names out of rendered Ingress manifests with
`yq`, and reconciling Hetzner DNS through a three-layer create/update/retry
cascade. kumulo already owns volumes, buckets and DNS as reconciling resources;
these three gaps are what stands between that and deleting the bash.

The ordering is forced, and it is the reason this work comes before the
migration rather than after it: MKS's update payload is
`Cloud_ProjectKubeUpdate = { name?, updatePolicy? }`
(`packages/distro-ovh-mks/src/generated/client.ts:64`). Networking is set at
creation and never again. A cluster created without a private network cannot be
given one — it can only be replaced, and MKS control-plane replacement is
already refused outright as "deleting the cluster and everything on it"
(`packages/cli/src/mks/reconcile.ts`, `_poolsToReplace`). There is exactly one
chance to get a cluster's networking right, and it is at creation.

## Shape of the solution

kumulo creates the private network and both subnets, hands their ids to MKS at
cluster creation, creates an Octavia load balancer on the LB subnet with a
floating IP, and resolves `target: ingress` to that floating IP.

The in-cluster ingress controller (Traefik, in the consuming repo) then *adopts*
that load balancer by id rather than asking for one of its own. This split is
deliberate and is the load-bearing design choice: **kumulo owns the load
balancer's lifecycle; the cloud-controller-manager owns its listeners, pools and
members.** Upstream `cloud-provider-openstack` supports it — a shared load
balancer "can be created either by other Services or outside the cluster, e.g.
created manually by the user in the cloud" — and protects it, since "the load
balancer is deleted only when the last attached Service is deleted, unless the
load balancer was created outside the Kubernetes cluster". OVH documents the
`loadbalancer.openstack.org/load-balancer-id` annotation for MKS.

That split is what makes one-step DNS possible. kumulo never waits for a
workload to appear: it allocates the address itself, before the cluster has any
workloads at all.

## Success criteria

1. An `ovh-mks` config declaring a network, an ingress LB and a
   `target: ingress` DNS record applies cleanly in one command, with no
   post-apply step and no polling for in-cluster state.
2. Re-applying that config is a no-op, including after an ingress controller has
   attached listeners to the load balancer.
3. `kumulo delete` removes network, subnets, LB and floating IP in an order that
   never strands a resource, while still honouring `retain` on volumes and
   buckets.
4. The k3s path — which shares `ensureNetwork`, `NetworkInfo` and
   `ensureLoadBalancer` — is behaviourally unchanged.
