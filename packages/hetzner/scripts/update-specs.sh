#!/usr/bin/env bash
# Re-fetch the vendored hcloud OpenAPI spec from Hetzner's official, unversioned
# spec URL. Unlike OpenStack's gtema/openstack-openapi mirror there's no git SHA
# to pin to, so this pins by content hash instead: fetch into a temp file, run it
# through denullify-spec.ts (see that file's header — works around a generator
# limitation with OpenAPI 3.1's `"type": [X, "null"]` idiom), compare the *result*'s
# sha256 against the committed sidecar (specs/hcloud/cloud.spec.json.sha256), and
# only overwrite + update the sidecar when the content actually changed — leaving a
# clean `git diff` as the review signal, same as OpenStack's SHA bump.
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SPEC="${DIR}/specs/hcloud/cloud.spec.json"
HASH_FILE="${SPEC}.sha256"
RAW="$(mktemp)"
DENULLIFIED="$(mktemp)"
trap 'rm -f "${RAW}" "${DENULLIFIED}"' EXIT

curl -sf --max-time 30 "https://docs.hetzner.cloud/cloud.spec.json" -o "${RAW}"
(cd "${DIR}" && bun run scripts/denullify-spec.ts "${RAW}" "${DENULLIFIED}")

NEW_HASH="$(shasum -a 256 "${DENULLIFIED}" | awk '{print $1}')"
OLD_HASH="$(cat "${HASH_FILE}" 2>/dev/null || echo "")"

if [ "${NEW_HASH}" = "${OLD_HASH}" ]; then
  echo "hcloud spec unchanged (sha256 ${NEW_HASH})."
  exit 0
fi

cp "${DENULLIFIED}" "${SPEC}"
echo "${NEW_HASH}" > "${HASH_FILE}"
echo "hcloud spec updated: ${OLD_HASH:-<none>} -> ${NEW_HASH}."
echo "Review 'git diff packages/hetzner/specs' for drift, then re-run 'bun run generate' in packages/hetzner."
