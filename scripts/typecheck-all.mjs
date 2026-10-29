#!/usr/bin/env node
// Run `tsc --noEmit` in every workspace package. Keeps going after a failure so
// one run reports every broken package, then exits non-zero.

import { spawnSync } from "node:child_process"
import path from "node:path"
import process from "node:process"
import { REPO_ROOT, workspacePackages } from "./workspace-packages.mjs"

const TSC = path.join(REPO_ROOT, "node_modules", ".bin", "tsc")

let failed = false

for (const { dir } of workspacePackages().toSorted((a, b) => a.dir.localeCompare(b.dir))) {
	console.log(`[typecheck] ${dir}`)
	const { status } = spawnSync(TSC, ["--noEmit"], { cwd: path.join(REPO_ROOT, dir), stdio: "inherit" })

	if (status !== 0) failed = true
}

process.exit(failed ? 1 : 0)
