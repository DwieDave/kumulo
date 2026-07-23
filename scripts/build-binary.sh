#!/usr/bin/env bash
set -euo pipefail

# NFR-7 — single-file `kumulo` binary via `bun build --compile`.
cd "$(dirname "$0")/.."
mkdir -p dist
bun build --compile --outfile dist/kumulo packages/cli/src/main.ts
