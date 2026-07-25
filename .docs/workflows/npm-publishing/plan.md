# npm Publishing Plan — @kumulo/*

Modeled on `.references/konfig.ts` (tag-triggered release, npm OIDC trusted
publishing, no tokens).

**Status 2026-07-25:** M1–M4 implemented by the release-readiness workflow
(11 agents). Gates green: typecheck ✓, lint ✓, 519/519 tests ✓. Remaining:
M5 manual steps + open decisions at the bottom.

## Publish model

- **Trigger:** git tag `v<semver>` pushed to GitHub. The tag is the source of
  truth; the workflow refuses to publish if any non-private package version
  differs from the tag.
- **Auth:** npm Trusted Publisher (OIDC) configured per package on npmjs.com
  → GitHub Actions → this repo → `release.yml`. No `NODE_AUTH_TOKEN`.
  Provenance attached automatically.
- **Versioning:** lockstep — every published package shares one version
  (start `0.1.0`). `scripts/bump-version.mjs` equivalent bumps all at once.
- **Scope:** `packages/*` publish as `@kumulo/*`; `tools/*` and the root stay
  `private: true`. `@kumulo/oxlint` (lint config) — decide: publish or keep
  private.

## Publish order (from the workspace dep graph)

```
core → addons, distro-k3s, distro-ovh-mks, dns-hetzner, dns-ovh,
       hetzner, openstack, provider-ovh, secrets-sops, storage-ovh,
       volumes-cinder (all parallel-safe) → cli
```

## Milestones

### M1 — Package manifests publishable
- Remove `private: true` from `packages/*` (not tools/root); set version `0.1.0`.
- Add `description`, `license`, `repository` (with per-package `directory`),
  `files: ["dist"]`, `publishConfig.access: public`.
- Exports: keep `src/index.ts` for dev; prepack script rewrites exports to
  `dist/` (konfig's `prepack-exports.mjs` pattern).
- `cli` bin must point at a built entry, not `src/main.ts`.

### M2 — Build to dist
- Emit JS + `.d.ts` per package (tsc/tsgo), `bun run build` at root.
- Port `scripts/rewrite-workspace-deps.cjs` — rewrite `workspace:*` and
  `catalog:` deps to concrete versions at release time (catalog: is
  bun-only; published manifests must carry real semver ranges).

### M3 — CI/CD workflows
- `.github/workflows/ci.yml`: typecheck, test, lint (informative at first),
  lint:deps, codegen:check on push/PR to main.
- `.github/workflows/release.yml`: tag→version verify, build, dry-run pack
  verify, publish in dep order via OIDC, SLSA attestation,
  `verify-reproducible` job diffing registry tarballs against the built dist.

### M4 — Hygiene before first tag
- LICENSE at root (+ per-package via `files`/root inheritance), README per
  package (npm renders it), CHANGELOG.
- Ensure `staging-eu.credentials.yaml` is gitignored and can never be packed.
- Zero TODO/FIXME blockers, clean typecheck/test/lint gates.

### M5 — First release
1. Configure Trusted Publisher for each @kumulo package on npmjs.com (manual,
   requires org owner).
2. Branch protection on `main` (block force-push).
3. `bump-version 0.1.0` → commit → `git tag v0.1.0` → push tag.
4. Watch release.yml; verify-reproducible must pass.

## Manual steps (cannot be automated)
- npmjs.com org `@kumulo` creation + Trusted Publisher config per package
  (GitHub Actions → repo → `release.yml`).
- GitHub branch protection on `main`.
- Confirm repo URL: agents assumed `https://github.com/DwieDave/kumulo`
  (no git remote configured) — fix `repository`/`homepage`/`bugs` if wrong.

## Open decisions (human call)
- `examples/ovh-mks.yaml`: uncommitted `retain: false → true` drift.
  Commit as the safer example default, or revert.
- Per-package LICENSE: `files` lists `LICENSE` but only the root file
  exists — copy into each package at prepack, or drop from `files`.
- `@kumulo/oxlint` stays private (internal lint config) — confirm.
- CHANGELOG compare links deferred until a git remote exists.
