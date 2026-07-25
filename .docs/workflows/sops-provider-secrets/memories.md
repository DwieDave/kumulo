# Memories

- Credential layers build when `Effect.provide` wraps `Command.run` — i.e. before argv/config parsing. Anything feeding `Config` must be installed at process start; that's why `--secrets-file` is stripped pre-parser (`Command.runWith`) instead of being a declared flag.
- Effect v4 `ConfigError.cause._tag === "SourceError"` distinguishes "source broken" from "key missing"; `Config.withDefault` only swallows missing-data, so SourceErrors still fail loudly.
- vitest needed `resolve.conditions: ["source", ...]` (plus ssr equivalents) or cross-package imports run against stale `dist` — same landmine the tsconfig `paths` fix covered for bun.
- `bun test` (native runner) is broken repo-wide vs `@effect/vitest` (`assert` export); `bun run test` (vitest) is the only supported runner.
- Known gap: `--secrets-file` is invisible to `--help` since it bypasses the parser; README-only documentation.
