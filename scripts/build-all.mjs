#!/usr/bin/env node
// Build every package under packages/ that has a build script, in topological
// order of their workspace dependencies (dependencies first, ties by name).

import { execFileSync } from "node:child_process"
import path from "node:path"
import process from "node:process"
import { REPO_ROOT, workspacePackages } from "./workspace-packages.mjs"

const buildable = workspacePackages().filter(({ dir, pkg }) => dir.startsWith("packages/") && pkg.scripts?.build)
const names = new Set(buildable.map((p) => p.name))

const _depsOf = ({ pkg }) =>
	Object.keys({ ...pkg.dependencies, ...pkg.devDependencies, ...pkg.peerDependencies }).filter((d) => names.has(d))

const ordered = []
const state = new Map()

const _visit = (p, trail) => {
	if (state.get(p.name) === "done") return

	if (state.get(p.name) === "active") throw new Error(`dependency cycle: ${[...trail, p.name].join(" -> ")}`)
	state.set(p.name, "active")

	for (const dep of _depsOf(p)) _visit(buildable.find((b) => b.name === dep), [...trail, p.name])

	state.set(p.name, "done")
	ordered.push(p)
}

for (const p of buildable) _visit(p, [])

if (process.argv.includes("--list")) {
	console.log(ordered.map((p) => p.name).join("\n"))
	process.exit(0)
}

for (const { dir } of ordered) {
	console.log(`[build] ${dir}`)
	execFileSync("bun", ["run", "build"], { cwd: path.join(REPO_ROOT, dir), stdio: "inherit" })
}
