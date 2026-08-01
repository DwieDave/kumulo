import { defineConfig } from "tsdown"

export default defineConfig({
	cwd: process.cwd(),
	entry: (process.env.TSDOWN_ENTRY ?? "src/index.ts").split(","),
	format: "esm",
	platform: "node",
	dts: false,
	clean: false,
	outDir: "dist",
	outExtensions: () => ({ js: ".mjs" }),
})
