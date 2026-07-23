/** Hexagonal dependency-direction rules (design Appendix A). */
module.exports = {
  options: {
    tsPreCompilationDeps: true,
    doNotFollow: { path: "node_modules" },
    tsConfig: { fileName: "tsconfig.base.json" },
  },
  forbidden: [
    {
      name: "core-only-imports-effect",
      comment: "@kumulo/core may import only 'effect', no other @kumulo/* or deps",
      severity: "error",
      from: { path: "^packages/core/src/" },
      to: { pathNot: "^(packages/core/src/|node_modules/(effect|@effect/))" },
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
