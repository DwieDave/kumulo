#!/usr/bin/env bash
# Refresh the vendored, trimmed Cloudflare API v4 OpenAPI spec. The source is a URL or a
# local file (CLOUDFLARE_SPEC_SOURCE or $1, default Cloudflare's published openapi.json on GitHub).
# scripts/trim-spec.mjs keeps only the operations the client calls and the components they use.
# Pins by content hash of the trimmed spec: only overwrites the spec and its sidecar when it changed.
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEFAULT_SOURCE="https://raw.githubusercontent.com/cloudflare/api-schemas/main/openapi.json"
SOURCE="${1:-${CLOUDFLARE_SPEC_SOURCE:-${DEFAULT_SOURCE}}}"
SPEC="${DIR}/specs/cloudflare-dns-v4.json"
HASH_FILE="${SPEC}.sha256"
WORK="$(mktemp -d)"
trap 'rm -rf "${WORK}"' EXIT

case "${SOURCE}" in
  http://*|https://*) curl -fsSL --max-time 120 "${SOURCE}" -o "${WORK}/full.json" ;;
  *) cp "${SOURCE}" "${WORK}/full.json" ;;
esac

node "${DIR}/scripts/trim-spec.mjs" "${WORK}/full.json" "${WORK}/trimmed.json"

NEW_HASH="$(shasum -a 256 "${WORK}/trimmed.json" | awk '{print $1}')"
OLD_HASH="$(cat "${HASH_FILE}" 2>/dev/null || echo "")"

if [ "${NEW_HASH}" = "${OLD_HASH}" ]; then
  echo "cloudflare spec unchanged (sha256 ${NEW_HASH})."
  exit 0
fi

mkdir -p "${DIR}/specs"
cp "${WORK}/trimmed.json" "${SPEC}"
echo "${NEW_HASH}" > "${HASH_FILE}"
echo "cloudflare spec updated: ${OLD_HASH:-<none>} -> ${NEW_HASH}."
echo "Review 'git diff packages/cloudflare/dns/specs' for drift."
