#!/usr/bin/env bash
# Build the package in $PWD for publishing: dist/index.mjs (bundled ESM, all
# packages external) + dist/**/*.d.ts (tsc, declarations only).
#
# Extra entry points may be passed as arguments (e.g. src/main.ts for the CLI);
# each is bundled to dist/<name>.mjs.
#
# Bundling is tsdown (rolldown); declarations stay on tsc, see scripts/tsdown.config.ts.
# No sourcemaps: maps pointing at src/ are useless in a tarball that ships only dist/.
#
# One script instead of the same three-command chain in 13 package.json files.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

rm -rf dist
"${ROOT}/node_modules/.bin/tsc" -p tsconfig.build.json
node "${ROOT}/scripts/dts-ext.mjs" dist

entries="src/index.ts"
for entry in "$@"; do entries="${entries},${entry}"; done
TSDOWN_ENTRY="${entries}" "${ROOT}/node_modules/.bin/tsdown" --config "${ROOT}/scripts/tsdown.config.ts"
