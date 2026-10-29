#!/usr/bin/env bash
# Refresh the vendored GoDaddy Domains v3 OpenAPI spec. The source is a URL or a
# local file (GODADDY_SPEC_SOURCE or $1, default .references/godaddy/domains-v3.json).
# Pins by content hash: only overwrites the spec and its sidecar when the sha256 changed.
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ROOT="$(cd "${DIR}/../../.." && pwd)"
SOURCE="${1:-${GODADDY_SPEC_SOURCE:-${ROOT}/.references/godaddy/domains-v3.json}}"
SPEC="${DIR}/specs/domains-v3.json"
HASH_FILE="${SPEC}.sha256"
RAW="$(mktemp)"
trap 'rm -f "${RAW}"' EXIT

case "${SOURCE}" in
  http://*|https://*) curl -sf --max-time 30 "${SOURCE}" -o "${RAW}" ;;
  *) cp "${SOURCE}" "${RAW}" ;;
esac

NEW_HASH="$(shasum -a 256 "${RAW}" | awk '{print $1}')"
OLD_HASH="$(cat "${HASH_FILE}" 2>/dev/null || echo "")"

if [ "${NEW_HASH}" = "${OLD_HASH}" ]; then
  echo "godaddy spec unchanged (sha256 ${NEW_HASH})."
  exit 0
fi

mkdir -p "${DIR}/specs"
cp "${RAW}" "${SPEC}"
echo "${NEW_HASH}" > "${HASH_FILE}"
echo "godaddy spec updated: ${OLD_HASH:-<none>} -> ${NEW_HASH}."
echo "Review 'git diff packages/godaddy/dns/specs' for drift."
