# Intent

Allow the provider/distro credentials the CLI currently requires as raw env vars
(OVH_CLIENT_ID, OVH_CLIENT_SECRET, OVH_SERVICE_NAME, HCLOUD_TOKEN,
HETZNER_DNS_TOKEN, OpenStack OS_* keys) to instead come from a sops-encrypted
YAML file, so secrets can live encrypted in the repo next to the cluster config
instead of in shell profiles / CI secret stores duplicating the same values.

## Why now

- The repo already uses sops+age for *writing* credentials (`@kumulo/secrets-sops`
  encrypt sink for S3 creds). Reading provider creds the same way closes the loop.
- Every credential read already funnels through `requiredEnv`/`requiredRedactedEnv`
  (`packages/cli/src/env.ts`), which use Effect `Config` — a swap of the ambient
  `ConfigProvider` covers all providers at once with zero consumer edits.

## Non-goals

- Encrypting the cluster config itself.
- A generic pluggable `SecretSource` port (one implementation → no port).
- Per-provider nesting/mapping in the secrets file (flat env-var names, no mapping layer).
