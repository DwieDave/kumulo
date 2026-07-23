#!/usr/bin/env bash
# Re-fetch vendored OpenStack OpenAPI specs from the pinned gtema/openstack-openapi
# revision (see memories.md for the exact commit + rationale). Deliberately not
# auto-bumped to `main` HEAD here: bump SHA below only when deciding to pick up
# upstream changes, then re-apply patches/regenerate and let CI's stale-patch
# check surface any drift.
set -euo pipefail

SHA="7bc4ee41e044e4f2f7dc09c8b1193cfc4bc8f8ad"
BASE="https://raw.githubusercontent.com/gtema/openstack-openapi/${SHA}/specs"
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/specs"

fetch() { curl -sf --max-time 30 "${BASE}/${1}" -o "${DIR}/${2}"; }

fetch identity/v3.14.yaml keystone/v3.14.yaml
fetch compute/v2.96.yaml nova/v2.96.yaml
fetch network/v2.yaml neutron/v2.yaml
fetch image/v2.16.yaml glance/v2.16.yaml
fetch block-storage/v3.70.yaml cinder/v3.70.yaml
fetch load-balancing/v2.yaml octavia/v2.yaml

echo "Vendored specs refreshed from ${SHA}. Review 'git diff packages/openstack/specs' for drift."
