#!/usr/bin/env node
// Strip the `.ts` extension from relative specifiers in emitted `.d.ts` files.
//
// Source imports use explicit `./x.ts` specifiers (allowImportingTsExtensions).
// TypeScript 7 does not implement `rewriteRelativeImportExtensions`, so the
// emitted declarations keep `./x.ts` — a specifier that no consumer can resolve
// against a tarball that only ships `./x.d.ts`. Dropping the extension makes
// them resolve normally.
//
//   node scripts/dts-ext.mjs dist

import fs from "node:fs"
import path from "node:path"
import process from "node:process"

const RELATIVE_TS = /(from\s+|import\s*\(\s*)("|')(\.[^"']*)\.ts\2/g

const _walk = function* (dir) {
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		const full = path.join(dir, entry.name)
		if (entry.isDirectory()) yield* _walk(full)
		else if (entry.name.endsWith(".d.ts")) yield full
	}
}

const _rewrite = (file) => {
	const raw = fs.readFileSync(file, "utf8")
	const next = raw.replace(RELATIVE_TS, "$1$2$3$2")
	if (next !== raw) fs.writeFileSync(file, next)
}

const root = path.resolve(process.cwd(), process.argv[2] ?? "dist")
if (!fs.existsSync(root)) {
	console.error(`dts-ext: no such directory "${root}"`)
	process.exit(1)
}
for (const file of _walk(root)) _rewrite(file)
