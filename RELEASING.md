# Releasing kumulo

How a maintainer publishes a version of the `@kumulo/*` packages to npm. Written
for 0.2.0. The later sections apply to every release.

## What has never run

Read this first. As of 2026-11-20:

- `.github/workflows/release.yml` has never run (0 runs on GitHub). 0.1.1 was
  published by hand from a laptop and has no provenance.
- No package on npm has a trusted publisher configured.
- Nobody has checked whether `npm trust` accepts a package name that does not
  exist on npm yet. Secondary sources say npm has no "pending publisher".
- The UpCloud and GoDaddy code in 0.2.0 has only run against fakes, never
  against the live APIs.

So the first run of each step below is also its test. Watch it.

## How the release workflow works

`release.yml` runs on a pushed tag `vX.Y.Z` (or `vX.Y.Z-*`). In order it:

1. Fails unless every non-private `package.json` under `packages/` has the
   tag's version.
2. Installs bun 1.4.4, Node 24 and the latest npm, then runs
   `bun install --frozen-lockfile`, `bun run typecheck`, `bun run build`,
   `bun run test` and `bun run lint`.
3. Runs `scripts/rewrite-workspace-deps.cjs`, which turns `workspace:*` and
   `catalog:` into real versions.
4. Publishes `@kumulo/core` first, `@kumulo/cli` last and the rest in
   between. Each package runs `npm pack --dry-run` first, then
   `npm publish --access public`. `prepack` strips the `bun` and `source`
   export conditions that point at `src/`.

It authenticates with OIDC (`id-token: write`). There is no npm token in the
repo. npm attaches provenance by itself.

Two things to know before the first run:

- The publish loop runs under `set -e` and does not skip versions that already
  exist. If package 7 of 21 fails, packages 1 to 6 are on npm and a re-run of
  the workflow fails on package 1. See [A publish stopped halfway](#a-publish-stopped-halfway).
- A prerelease tag (`v0.2.0-rc.0`) publishes without `--tag`, so it would
  become `latest` or fail. Do not push prerelease tags until the workflow
  passes `--tag next` for them.

## Packages

21 public packages, all on one version. `@kumulo/oxlint` is private and keeps
its own version.

Already on npm (0.1.1), 12 names:
`@kumulo/cli`, `@kumulo/core`, `@kumulo/distro-k3s`, `@kumulo/distro-ovh-mks`,
`@kumulo/dns-hetzner`, `@kumulo/dns-ovh`, `@kumulo/hetzner`,
`@kumulo/openstack`, `@kumulo/provider-ovh`, `@kumulo/secrets-sops`,
`@kumulo/storage-ovh`, `@kumulo/volumes-cinder`.

New with 0.2.0, 9 names that npm does not have yet:
`@kumulo/bunny`, `@kumulo/cdn-bunny`, `@kumulo/distro-upcloud-uks`,
`@kumulo/dns-bunny`, `@kumulo/dns-godaddy`, `@kumulo/storage-bunny`,
`@kumulo/storage-upcloud`, `@kumulo/upcloud`, `@kumulo/volumes-upcloud`.

On npm but gone from the repo: `@kumulo/addons` (merged into the provider and
distro packages).

## Steps for 0.2.0

The version bump and the changelog entry are already on branch
`release/0.2.0` (`bun run version:bump 0.2.0` has run, `bun.lock` is in sync).

### 1. Merge to main

Open a pull request from `release/0.2.0` to `main` and merge it once the `ci`
workflow is green. Check out `main` and confirm locally:

```sh
git checkout main && git pull
bun install --frozen-lockfile
bun run ci
```

### 2. Set up trusted publishing

You need to be an owner of the `@kumulo` scope on npm and logged in
(`npm login`). `npm trust` needs npm 11.10 or later (`npm --version`).

For each of the 12 names already on npm, add a trusted publisher: GitHub
Actions, repository `DwieDave/kumulo`, workflow file `release.yml`, no
environment. Either on npmjs.com (package, Settings, Trusted Publisher) or on
the command line. Check the exact syntax with `npm trust --help` first:

```sh
npm trust github @kumulo/core --file release.yml --repo DwieDave/kumulo
```

npm's docs say a new trusted-publisher configuration expires when no publish
uses it within about two days. Set it up shortly before step 4.

For the 9 new names there is no package to configure yet. Pick one way:

- **(a) Placeholders, then the workflow (recommended).** First try
  `npm trust github <name> ...` on one new name. If npm accepts it, configure
  all nine that way and skip the placeholders. If it refuses, publish a
  placeholder of each new name by hand, then configure trust:

  ```sh
  dir=$(mktemp -d) && cd "$dir"
  printf '{"name":"%s","version":"0.0.1","description":"placeholder, use 0.2.0 or later","license":"MIT"}\n' @kumulo/upcloud > package.json
  npm publish --access public
  npm deprecate @kumulo/upcloud@0.0.1 "placeholder, use 0.2.0 or later"
  ```

  Repeat for each of the nine names. Never hand-publish `0.2.0` itself: the
  workflow would then fail on that package (see above).

- **(b) Publish 0.2.0 by hand, like 0.1.1.** Skip the workflow for this release
  and set up trust for 0.2.1. On a clean checkout of `main` after step 1:

  ```sh
  bun install --frozen-lockfile
  bun run build
  node scripts/rewrite-workspace-deps.cjs
  # then npm publish --access public in each package dir: core first, cli last
  ```

  This gives no provenance, and the tag push in step 4 still starts the
  workflow, which then fails on its first package. Cancel that run.

### 3. Tag

Tag the merge commit on `main` that carries version 0.2.0:

```sh
git tag -a v0.2.0 -m "Release v0.2.0"
git push origin v0.2.0
```

### 4. Watch the run

```sh
gh run list --workflow release.yml --limit 1
gh run watch <run-id>
```

The run takes the full test suite plus 21 publishes. If it fails before the
publish step, nothing reached npm: fix, delete the tag
(`git push origin :refs/tags/v0.2.0 && git tag -d v0.2.0`), and tag again.

### 5. Verify

```sh
# every package is at 0.2.0
for p in bunny cdn-bunny cli core distro-k3s distro-ovh-mks distro-upcloud-uks \
  dns-bunny dns-godaddy dns-hetzner dns-ovh hetzner openstack provider-ovh \
  secrets-sops storage-bunny storage-ovh storage-upcloud upcloud volumes-cinder volumes-upcloud; do
  printf '%s ' "@kumulo/$p"; npm view "@kumulo/$p@0.2.0" version
done

# the CLI pulls in the UpCloud distro and GoDaddy DNS
npm view @kumulo/cli@0.2.0 dependencies

# provenance: attestations are present (empty on 0.1.1)
npm view @kumulo/cli@0.2.0 dist.attestations

# the CLI starts and reports its version
npx -y @kumulo/cli@0.2.0 --version     # kumulo v0.2.0
```

Then the first live check, in an empty directory with a real config and real
tokens (the UpCloud token can list clusters and networks, the GoDaddy token has
`domains.dns:update`):

```sh
export UPCLOUD_API_TOKEN=... GODADDY_API_TOKEN=...
npx -y @kumulo/cli@0.2.0 --dry-run apply cluster.json
```

It must print a plan and change nothing. A GoDaddy 403 here means the token
lacks the scope or the account is not eligible for the DNS API (see README,
GoDaddy DNS).

### 6. Clean up

```sh
npm deprecate @kumulo/addons@0.1.1 "merged into the provider and distro packages in 0.2.0"
```

Optionally create a GitHub release for `v0.2.0` from the changelog entry.

## Later releases

1. `bun run version:bump <x.y.z>` (or `patch`, `minor`, `major`). It sets every
   public package and syncs `bun.lock`.
2. Move the `[Unreleased]` entries under a new `## [x.y.z] - YYYY-MM-DD`
   heading in `CHANGELOG.md`.
3. `bun run ci`, commit, merge to `main`.
4. Tag `vX.Y.Z` on `main` and push the tag. Verify as in step 5.

A new package name needs the placeholder step from 2(a) before its first
release.

## A publish stopped halfway

npm versions are immutable, and a re-run of the workflow stops at the first
package that already exists. Two ways out:

- Publish the remaining packages by hand from a clean checkout of the tag:
  `bun install --frozen-lockfile && bun run build && node scripts/rewrite-workspace-deps.cjs`,
  then `npm publish --access public` in each remaining package directory, in
  the order the workflow log printed. These copies have no provenance.
- Or fix the cause, bump to the next patch version and release that. The
  half-published version stays on npm; deprecate it with `npm deprecate`.
