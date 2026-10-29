// List every workspace package by expanding the root `workspaces.packages`
// globs, so nested provider folders (packages/bunny/cdn) are found too.
// Only `*` path segments are supported; that is all the root package.json uses.
//
//   import { workspacePackages } from "./workspace-packages.mjs"
//   workspacePackages() // [{ dir: "packages/bunny/cdn", name: "@kumulo/cdn-bunny", pkg }]

import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")

const _readJson = (p) => JSON.parse(fs.readFileSync(p, "utf8"))

const _expand = (pattern) => {
	let dirs = [""]

	for (const segment of pattern.split("/")) {
		dirs = dirs.flatMap((dir) => {
			if (segment !== "*") return [path.posix.join(dir, segment)]

			const abs = path.join(REPO_ROOT, dir)

			if (!fs.existsSync(abs)) return []

			return fs
				.readdirSync(abs, { withFileTypes: true })
				.filter((entry) => entry.isDirectory())
				.map((entry) => path.posix.join(dir, entry.name))
		})
	}

	return dirs
}

export const workspacePackages = () => {
	const patterns = _readJson(path.join(REPO_ROOT, "package.json")).workspaces.packages
	const dirs = new Set(patterns.flatMap(_expand))

	return [...dirs]
		.flatMap((dir) => {
			const pkgJsonPath = path.join(REPO_ROOT, dir, "package.json")

			if (!fs.existsSync(pkgJsonPath)) return []
			const pkg = _readJson(pkgJsonPath)

			return [{ dir, name: pkg.name, pkg }]
		})
		.toSorted((a, b) => a.name.localeCompare(b.name))
}
