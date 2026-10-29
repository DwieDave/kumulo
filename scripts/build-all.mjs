#!/usr/bin/env node
// Build every package under packages/ that has a build script: the leaves
// (no @kumulo/* deps besides core) first, then the rest by name, then the CLI.

import { execFileSync } from "node:child_process"
import path from "node:path"
import { REPO_ROOT, workspacePackages } from "./workspace-packages.mjs"

const LEAVES = ["@kumulo/core", "@kumulo/bunny", "@kumulo/upcloud"]
const CLI = "@kumulo/cli"

const buildable = workspacePackages().filter(({ dir, pkg }) => dir.startsWith("packages/") && pkg.scripts?.build)
const leaves = LEAVES.flatMap((name) => buildable.filter((p) => p.name === name))
const rest = buildable.filter((p) => !LEAVES.includes(p.name) && p.name !== CLI)
const cli = buildable.filter((p) => p.name === CLI)

for (const { dir } of [...leaves, ...rest, ...cli]) {
	console.log(`[build] ${dir}`)
	execFileSync("bun", ["run", "build"], { cwd: path.join(REPO_ROOT, dir), stdio: "inherit" })
}
