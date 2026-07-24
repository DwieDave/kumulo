#!/usr/bin/env bash
# Re-fetch OVH's proprietary v1 schema JSON (never done in tests — network only here).
# Drift shows up as a clean `git diff` on specs/ovh/*.json, or a hard failure
# downstream in the converter/patch/generate pipeline.
set -euo pipefail

dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/specs/ovh"

curl -sS -o "$dir/cloud.json" https://eu.api.ovh.com/1.0/cloud.json
curl -sS -o "$dir/domain.json" https://eu.api.ovh.com/1.0/domain.json

echo "Updated $dir/cloud.json and $dir/domain.json"
