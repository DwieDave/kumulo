#!/usr/bin/env node
// Generate the `paths` maps of tsconfig.base.json (source entries) and
// tsconfig.build.base.json (dist .d.ts entries) from every workspace package's
// `exports`. `--check` fails when either file is stale instead of writing.
//
//   node scripts/sync-tsconfig-paths.mjs          # rewrite both files
//   node scripts/sync-tsconfig-paths.mjs --check  # CI: exit 1 when stale

import fs from "node:fs"
import path from "node:path"
import process from "node:process"
import { REPO_ROOT, workspacePackages } from "./workspace-packages.mjs"

const _entries = ({ name, pkg }) => {
	const exportsMap = pkg.exports ?? {}

	return Object.entries(exportsMap)
		.filter(([sub, value]) => sub.startsWith(".") && value !== null && !Array.isArray(value) && Object.keys(value).length > 0)
		.map(([sub, value]) => ({
			key: sub === "." ? name : `${name}/${sub.slice(2)}`,
			source: value.source,
			types: value.types,
		}))
}

const _paths = ({ field, root }) => {
	const out = {}

	const all = workspacePackages()
		.filter(({ dir }) => dir.startsWith("packages/"))
		.flatMap((p) => _entries(p).map((e) => ({ ...e, dir: p.dir })))
		.filter((e) => e[field])
		.toSorted((a, b) => a.key.localeCompare(b.key))

	for (const e of all) out[e.key] = [`./${path.posix.join(e.dir, e[field].replace(/^\.\//, ""))}`]

	out["@kumulo/*"] = [root]

	return out
}

// Keep string arrays on one line, as the files were hand-written.
const _compact = (text) => text.replace(/\[\n\s+((?:"[^"\n]*",?\n\s+)*"[^"\n]*")\n\s+\]/g, (_, body) => `[${body.replace(/,\n\s+/g, ", ")}]`)

const _render = ({ file, field, wildcard }) => {
	const abs = path.join(REPO_ROOT, file)
	const json = JSON.parse(fs.readFileSync(abs, "utf8"))

	json.compilerOptions.paths = _paths({ field, root: wildcard })

	return { abs, text: `${_compact(JSON.stringify(json, null, 2))}\n` }
}

const targets = [
	{ file: "tsconfig.base.json", field: "source", wildcard: "./packages/*/src/index.ts" },
	{ file: "tsconfig.build.base.json", field: "types", wildcard: "./packages/*/dist/index.d.ts" },
]

let stale = false

for (const target of targets) {
	const { abs, text } = _render(target)
	const current = fs.readFileSync(abs, "utf8")

	if (process.argv.includes("--check")) {
		if (current !== text) {
			console.error(`${target.file} is stale: run \`bun run tsconfig:sync\``)
			stale = true
		}
	} else if (current !== text) fs.writeFileSync(abs, text)
}

process.exit(stale ? 1 : 0)
