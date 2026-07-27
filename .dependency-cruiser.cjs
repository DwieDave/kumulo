/** Hexagonal dependency-direction rules (design Appendix A). */
module.exports = {
  options: {
    // kumulo: dependency-cruiser 18 refuses typescript@7 (peer range <7.0.0) and prints
    // `missing-typescript-transpiler`, so `tsPreCompilationDeps` is inert — the built-in
    // TS-capable fallback parser does the extraction. Measured, that fallback is the BEST
    // available option here, not a degraded one: it cruises 678 modules / 2342 deps vs
    // `parser: "swc"` (@swc/core is in the catalog) at 674 / 2328, and both flag a
    // deliberate `import type` sibling-import probe. So the no-sibling-import guarantee
    // holds; do not "fix" the warning by switching to swc — that loses edges.
    tsPreCompilationDeps: true,
    doNotFollow: { path: "node_modules" },
    tsConfig: { fileName: "tsconfig.base.json" },
  },
  forbidden: [
    {
      name: "core-only-imports-effect",
      comment:
        "@kumulo/core may import only 'effect' plus 'yaml' (pure data parsing, no I/O — T1.2 config schema's " +
        "YAML helper; Bun.YAML isn't reachable under vitest's worker runtime, see memories.md), no other @kumulo/* or deps",
      severity: "error",
      from: { path: "^packages/core/src/" },
      // kumulo: bun nests deps per-package (no root hoist) and dependency-cruiser
      // can't resolve bare "effect"/"@effect/*" specifiers here, so it reports the
      // unresolved module name itself as the "path" — match that too, not just a
      // resolved node_modules path.
      // kumulo: bun nests transitive deps under node_modules/.bun/<pkg>@<version>/node_modules/<pkg>/
      // (no flat hoist), so the resolved "yaml" path needs its own alternative alongside the
      // top-level node_modules/yaml/ case; kept flat (no nested unbounded quantifiers) so
      // dependency-cruiser's ReDoS guard doesn't reject it.
      to: {
        pathNot:
          "^(packages/core/src/|node_modules/(effect|@effect/|yaml)/|node_modules/\\.bun/yaml@[^/]+/node_modules/yaml/|effect$|effect/|@effect/|yaml$)",
      },
    },
    {
      name: "no-sibling-package-imports",
      comment:
        "non-core, non-cli @kumulo/* packages may depend on core only, never on each other",
      severity: "error",
      from: { path: "^packages/(?!core/|cli/)([^/]+)/" },
      to: {
        path: "^packages/(?!core/)[^/]+/",
        pathNot: "^packages/$1/",
      },
    },
    {
      name: "ovh2openapi-no-kumulo-imports",
      comment: "tools/ovh2openapi imports no @kumulo/* packages",
      severity: "error",
      from: { path: "^tools/ovh2openapi" },
      to: { path: "^packages/" },
    },
    {
      name: "no-deep-package-imports",
      comment: "only package-root imports allowed, never into another package's src internals",
      severity: "error",
      from: { path: "^(packages|tools)/([^/]+)/" },
      to: {
        path: "^packages/[^/]+/src/(?!index\\.ts$).+",
        pathNot: "^packages/$2/",
      },
    },
  ],
};
