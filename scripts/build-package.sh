#!/usr/bin/env bash
# Build the package in $PWD for publishing: dist/index.mjs (bundled ESM, all
# packages external) + dist/**/*.d.ts (tsc, declarations only).
#
# Extra entry points may be passed as arguments (e.g. src/main.ts for the CLI);
# each is bundled to dist/<name>.mjs.
#
# No --sourcemap: with it, bun 1.3.13 writes the bundle next to the entry point
# (src/index.mjs) instead of the --outfile path, and maps pointing at src/ are
# useless in a tarball that ships only dist/.
#
# One script instead of the same three-command chain in 13 package.json files.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

bundle() {
	local entry="$1"
	local name
	name="$(basename "${entry%.ts}")"
	bun build "./${entry}" --outfile "dist/${name}.mjs" --target node --format esm --packages external
}

rm -rf dist
"${ROOT}/node_modules/.bin/tsc" -p tsconfig.build.json
node "${ROOT}/scripts/dts-ext.mjs" dist
bundle "src/index.ts"
for entry in "$@"; do bundle "${entry}"; done
