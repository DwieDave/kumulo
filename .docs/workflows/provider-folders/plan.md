# Move provider-specific packages into provider folders

## Context

`packages/` has 22 packages in one flat folder, and the provider name sits in a different place in each folder name (`cdn-bunny`, `provider-ovh`, `distro-upcloud-uks`). The goal is to group each provider's packages under `packages/<provider>/` with short role names. Packages that aren't tied to one provider stay flat.

This change touches folders only. The npm names (`@kumulo/...`) and import specifiers stay the same.

When execution starts, copy this plan to `.docs/workflows/provider-folders/plan.md` so it sits with the other workflow docs.

## Target layout

| Today | After | npm name (unchanged) |
|---|---|---|
| `bunny` | `bunny/client` | `@kumulo/bunny` |
| `cdn-bunny` | `bunny/cdn` | `@kumulo/cdn-bunny` |
| `dns-bunny` | `bunny/dns` | `@kumulo/dns-bunny` |
| `storage-bunny` | `bunny/storage` | `@kumulo/storage-bunny` |
| `provider-ovh` | `ovh/client` | `@kumulo/provider-ovh` |
| `dns-ovh` | `ovh/dns` | `@kumulo/dns-ovh` |
| `storage-ovh` | `ovh/storage` | `@kumulo/storage-ovh` |
| `distro-ovh-mks` | `ovh/distro-mks` | `@kumulo/distro-ovh-mks` |
| `upcloud` | `upcloud/client` | `@kumulo/upcloud` |
| `storage-upcloud` | `upcloud/storage` | `@kumulo/storage-upcloud` |
| `volumes-upcloud` | `upcloud/volumes` | `@kumulo/volumes-upcloud` |
| `distro-upcloud-uks` | `upcloud/distro-uks` | `@kumulo/distro-upcloud-uks` |
| `hetzner` | `hetzner/client` | `@kumulo/hetzner` |
| `dns-hetzner` | `hetzner/dns` | `@kumulo/dns-hetzner` |
| `openstack` | `openstack/client` | `@kumulo/openstack` |
| `volumes-cinder` | `openstack/volumes` | `@kumulo/volumes-cinder` |

These stay flat: `addons`, `cli`, `core`, `distro-k3s`, `oxlint`, `secrets-sops`.

A provider folder holds only packages and never has its own `package.json`. That's why every provider's base package moves into `client/`. Note that `provider-ovh` is an OVH profile and OAuth package rather than an API client, but it goes in `ovh/client` to keep the pattern the same everywhere.

## Step 0: Precondition

The Bunny packages (`packages/bunny`, `cdn-bunny`, `dns-bunny`, `storage-bunny`) are untracked, and many other files have uncommitted changes. Commit that work first. The move should then be one commit made with `git mv`, so git history follows the files and the diff contains only path changes.

## Step 1: Move the folders

Run `git mv` for each row of the table. Then run `bun install` to regenerate `bun.lock` (its workspace keys contain paths) and rebuild the `node_modules` symlinks.

## Step 2: Shared package-listing helper

Five places list packages by reading `packages/` one level deep, and every one of them would quietly skip the nested packages:

- the root `build` script
- `typecheck`
- `scripts/bump-version.mjs:99-110`
- `scripts/rewrite-workspace-deps.cjs:91-99`
- `.github/workflows/release.yml:40,95-97`

Add `scripts/workspace-packages.mjs`. It expands the root `workspaces.packages` globs and returns `{ dir, name, pkg }` for every folder that contains a `package.json`. Make all five places use it:

- **build:** move the inline `node -e` into `scripts/build-all.mjs`. Keep the existing ordering (leaves first, then the rest sorted, then `cli`), but key the leaves by package name (`@kumulo/core`, `@kumulo/bunny`, `@kumulo/upcloud`) instead of folder name.
- **typecheck:** move it into `scripts/typecheck-all.mjs`. For every package dir plus `tools/*`, run `tsc --noEmit` with that dir as cwd, calling the root `node_modules/.bin/tsc` by absolute path rather than `../../`.
- **bump-version, rewrite-workspace-deps, release.yml:** replace the `readdirSync` loops with the helper. In `release.yml`, `cd "packages/$pkg"` keeps working once `$pkg` is a relative dir like `bunny/cdn`.

## Step 3: Root config

- **`package.json` workspaces:** keep `"packages/*"` and add `"packages/bunny/*"`, `"packages/ovh/*"`, `"packages/upcloud/*"`, `"packages/hetzner/*"` and `"packages/openstack/*"`. Use explicit entries, not `packages/*/*`, which would also match every `src/` and `test/`. Check that bun ignores the provider folders themselves, since they have no `package.json`.
- **`package.json` scripts:** point `specs:update:openstack` and `specs:update:hetzner` at `packages/{openstack,hetzner}/client/scripts/update-specs.sh`.
- **`tsconfig.base.json` `paths`:** keep the `@kumulo/*` → `./packages/*/src/index.ts` wildcard for flat packages and add an exact entry for each of the 16 moved packages, e.g. `"@kumulo/cdn-bunny": ["./packages/bunny/cdn/src/index.ts"]`. Exact keys take priority over the wildcard. Without these entries, TypeScript and dependency-cruiser silently fall back to stale `dist/` typings, the problem described in `vitest.config.ts:3-5`.
- **New `tsconfig.build.base.json`** at the root, containing only `paths`: the same 16 exact entries pointing at `dist/index.d.ts`, plus the `./packages/*/dist/index.d.ts` wildcard. These paths resolve relative to the root.
- **`vitest.config.ts:12`:** add `"packages/*/*/test/**/*.test.ts"`. Without it, the moved packages' tests silently stop running.
- **`.oxlintrc.json:91`:** change `packages/*/src/generated/**` to `packages/**/src/generated/**`.

## Step 4: dependency-cruiser (`.dependency-cruiser.cjs`)

The goal here is to keep each rule's meaning the same, not just to get it passing.

- **`:45-48` (no sibling imports):** the package capture becomes `^packages/(?!core/|cli/)((?:bunny|ovh|upcloud|hetzner|openstack)/[^/]+|[^/]+)/`, with `pathNot: "^packages/$1/"`. That way `bunny/cdn` → `bunny/dns` is still forbidden.
- **`:47` (D15 exemption):** change `bunny/` and `upcloud/` to `bunny/client/` and `upcloud/client/`. Otherwise the exemption would cover every Bunny and UpCloud package.
- **`:62-64` (no deep imports):** make both the `from` capture and the `to` path accept the optional provider segment, so `packages/bunny/cdn/src/x.ts` is still caught.
- **Verify** with a temporary probe: a sibling import (`bunny/cdn` → `bunny/dns` src) and a deep import must both fail `lint:deps`. Remove the probe afterwards.

## Step 5: Per-package files (all 16 moved packages)

This is the same mechanical change in every package. Representative files are `packages/bunny/cdn/{tsconfig.json,tsconfig.build.json,package.json,README.md}`.

- `tsconfig.json`: change `"extends": "../../tsconfig.base.json"` to `"../../../tsconfig.base.json"`.
- `tsconfig.build.json`: remove the local `paths` and change to `"extends": ["./tsconfig.json", "../../../tsconfig.build.base.json"]`. The flat packages get the same change with `../../`, because their `../*/dist` lookup can't find nested siblings either.
- `package.json`: set `repository.directory` to the new path, and change `../../scripts/build-package.sh` and `../../scripts/prepack-exports.mjs` to `../../../scripts/...`.
- `README.md`: change `../../README.md` and `../../CHANGELOG.md` to `../../../`.

## Step 6: Codegen and generated-client inputs

- `tools/codegen/services.json:4-64`: rewrite every `specPath`, `allowlistPath`, `patchPaths` and `outputPath` for openstack, volumes-cinder and hetzner.
- `tools/codegen/src/bin/check.ts:79-90`: update the OVH `outputPath`s and the `import("../../../../packages/<name>/scripts/generate.ts")` paths.
- `tools/codegen/test/ovhPipelines.test.ts:17-18`: update the `pkgDir`s.
- `allowlist.json:3` in `ovh/{dns,storage,distro-mks}`: change `../../tools/ovh2openapi/...` to `../../../tools/...`.
- `openstack/volumes/allowlists/cinder.json:3`: `"../openstack/specs/..."` becomes `"../client/specs/..."`.

## Step 7: Text-only references

Update comments and printed messages that name the old paths:

- `update-specs.sh` echo lines
- the `freeform-map.test.ts` headers
- `packages/core/test/k8s/fake-http-client.ts:6`
- `packages/cli/test/secrets-file.test.ts:36`
- `packages/addons/src/manifests/cilium.ts:8`
- `packages/upcloud/README.md:18-24`

Leave the old `.docs/workflows/*` docs as they are, since they record history.

## Verification

1. `bun install --frozen-lockfile` passes after committing the new lock.
2. `bun run ci` passes. It runs typecheck, build, test, lint:deps, lint, codegen:check and schema:check.
3. Before and after the move, compare `vitest run` test counts and the `depcruise` module and dependency counts. They should match. A drop means something is silently being skipped.
4. Run the Step 4 dependency-cruiser probe.
5. `rg -n "packages/(bunny|cdn-bunny|dns-bunny|storage-bunny|provider-ovh|dns-ovh|storage-ovh|distro-ovh-mks|upcloud|storage-upcloud|volumes-upcloud|distro-upcloud-uks|hetzner|dns-hetzner|openstack|volumes-cinder)\b" --glob '!.docs/**' --glob '!bun.lock'` returns only the new nested paths.
6. In a scratch copy, run `node scripts/rewrite-workspace-deps.cjs` and check that a nested package such as `packages/bunny/cdn/package.json` has no `workspace:` or `catalog:` left. Then run `bun pm pack` on that package and check that the tarball has `dist/`.
7. Build and smoke test the CLI with `examples/cli-smoke.test.ts`.
