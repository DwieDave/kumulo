import { defineConfig } from "vitest/config"

// Workspace packages ship both `src` and a build output; without the `source`
// condition their `import` entry wins and tests silently run against a stale
// `dist` (the same landmine the tsconfig `paths` fix addressed for bun).
const _conditions = ["source", "import", "module", "default"]

export default defineConfig({
  resolve: { conditions: _conditions },
  ssr: { resolve: { conditions: _conditions, externalConditions: _conditions } },
  test: {
    include: ["packages/*/test/**/*.test.ts", "tools/*/test/**/*.test.ts", "examples/*.test.ts"]
  }
})
