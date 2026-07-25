# Memories

- Credential layers must not be provided around `Command.run` (they'd build before argv parsing). `Command.provide(cli, (input) => layer)` builds the layer per invocation *after* parsing — that's how `--secrets-file` is a real shared flag (in `--help`) whose value reaches the `ConfigProvider` the layers read from. `Layer.provideMerge` keeps the provider exposed for handler-time `Config` reads too.
- Effect v4 `ConfigError.cause._tag === "SourceError"` distinguishes "source broken" from "key missing"; `Config.withDefault` only swallows missing-data, so SourceErrors still fail loudly.
- vitest needed `resolve.conditions: ["source", ...]` (plus ssr equivalents) or cross-package imports run against stale `dist` — same landmine the tsconfig `paths` fix covered for bun.
- `bun test` (native runner) is broken repo-wide vs `@effect/vitest` (`assert` export); `bun run test` (vitest) is the only supported runner.
- (Resolved) `--secrets-file` was initially stripped pre-parser and invisible to `--help`; now a native shared flag via `Command.provide`.
