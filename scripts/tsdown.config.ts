import { defineConfig } from "tsdown"

// Shared bundler config for every publishable package. Invoked from
// scripts/build-package.sh with cwd = the package directory; entries come in
// via TSDOWN_ENTRY (comma-separated) so one config serves all packages.
//
// Declarations are NOT emitted here: `tsc -p tsconfig.build.json` already emits
// the full .d.ts tree (then dts-ext.mjs strips `.ts` specifiers), and tsdown's
// dts pass would duplicate that with a different toolchain.
//
// Externals: tsdown externalizes `dependencies` + `peerDependencies` of the
// package being built, which is what `bun build --packages external` did.
export default defineConfig({
	// The config lives in scripts/, but the build runs in the package dir —
	// without this, tsdown resolves entries/tsconfig against scripts/.
	cwd: process.cwd(),
	entry: (process.env.TSDOWN_ENTRY ?? "src/index.ts").split(","),
	format: "esm",
	platform: "node",
	dts: false,
	clean: false, // build-package.sh already rm -rf'd dist, and tsc ran first
	outDir: "dist",
	outExtensions: () => ({ js: ".mjs" }),
})
