# Intent

Make the Hetzner DNS module work when the cluster uses the OVH MKS distro.

Today `distro: ovh-mks` + `dns.module: hetzner` validates but is a silent no-op:
DNS reconciliation (`_reconcileDns`, `_dnsProviderLayerFor`) lives only inside the
k3s branch (`packages/cli/src/k3s/reconcile.ts:189/267`), and the MKS apply/delete
paths in `packages/cli/src/commands.ts` never touch DNS.

The user wants DNS records for an MKS cluster managed by Hetzner DNS, and wants
invalid/unsupported combos to fail loudly at config validation instead of no-op'ing.
