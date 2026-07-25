# Scope

## In scope

- Hoist DNS reconcile + provider-layer selection out of `k3s/reconcile.ts` into a
  shared CLI module usable by both distros.
- Generalize the `api_server` record target to support IP (k3s LB VIP → A record)
  and hostname (MKS `apiEndpoint` → CNAME record).
- Wire DNS ensure into `applyMks` and DNS removal into the MKS delete flow.
- Cross-field validation in `core` schema: `dns.module` must be a combo the CLI
  actually wires for the chosen distro/provider.
- Surface DNS actions in plan output (k3s and mks plan builders).

## Out of scope (YAGNI)

- Per-node A records / round-robin ingress records for MKS (OVH client surfaces no
  node IPs today). CNAME to the control-plane endpoint covers `api_server`.
- New DNS modules; only the existing `hetzner` (and existing k3s-only modules
  unchanged) are touched.
- Changes to the `dns-hetzner` package API itself — record types A/CNAME already
  supported.
