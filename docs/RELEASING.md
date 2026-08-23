# Releasing

Two packages, one version, one tag:

| package | npm |
| --- | --- |
| `packages/core` | [`ankou-core`](https://www.npmjs.com/package/ankou-core) |
| `packages/cli` | [`ankou`](https://www.npmjs.com/package/ankou) |

The CLI depends on core, so they go out together and share a version number.

## Cutting a release

1. **Bump both `package.json` versions to the same number.** The release
   workflow refuses to publish if they disagree, or if the tag disagrees with
   them.
2. **Move the `Unreleased` entries in [CHANGELOG.md](../CHANGELOG.md) under a
   `## <version> — <date>` heading.** The GitHub Release notes are lifted from
   that section by heading, so the heading has to start with the bare version.
3. Commit, and let CI go green on `main`.
4. **Tag and push:**

   ```sh
   git tag -a v0.2.0 -m "v0.2.0"
   git push origin v0.2.0
   ```

The `Release` workflow then runs the full CI gate again, packs both packages
(pnpm rewrites `workspace:*` into the real version as it packs), publishes core
before the CLI with [provenance][provenance] attached, and opens a GitHub
Release with the tarballs and this version's changelog.

**Rehearse it** any time with `Actions → Release → Run workflow`: identical run,
except the publish is `--dry-run` and no release is opened.

## What the workflow needs

- **`NPM_TOKEN`** — a repository secret, an npm **granular access token** scoped
  to those two packages with read-write permission. Nothing else uses it.
- **`id-token: write`** — already in the workflow. This is what lets npm attach
  provenance, and provenance needs the repository to be public.

### Trusted publishing (recommended, once both packages exist)

npm can trust this workflow directly instead of holding a long-lived token. On
each package's npm settings page, add a trusted publisher: this repository,
workflow `release.yml`. Then delete the `NPM_TOKEN` secret — the workflow keeps
working, because npm authenticates the run through OIDC.

This cannot be set up before the first publish, since the package has to exist
to be configured. So: first release with a token, then switch.

## The first publish

The very first release is the only one with a bootstrapping problem: the names
are unclaimed and there is no token yet.

```sh
npm login                       # or create a granular token at npmjs.com
gh secret set NPM_TOKEN         # paste the token
```

Then tag as above. If you would rather claim the names by hand first:

```sh
pnpm install --frozen-lockfile && pnpm build && pnpm test
( cd packages/core && pnpm pack --pack-destination /tmp/ankou )
( cd packages/cli  && pnpm pack --pack-destination /tmp/ankou )
npm publish /tmp/ankou/ankou-core-0.1.0.tgz --access public
npm publish /tmp/ankou/ankou-0.1.0.tgz --access public
```

`pnpm pack` rather than `npm publish` from the package directory: only pnpm
rewrites the `workspace:*` dependency into a real version. Publishing the
directory directly ships a manifest npm cannot install.

A local publish has no provenance. Tag the same commit afterwards so the GitHub
Release and the changelog still line up — the workflow's publish step will fail
on "you cannot publish over the previously published version", which is
expected; the tarballs and the release are still produced by re-running it after
bumping, or open the release by hand for that one version.

## After publishing

- `npm view ankou` and `npm view ankou-core` — check the
  version, the `bin`, and that the dependency on core resolved to a real range.
- Install it somewhere clean: `npm i -g ankou && ankou --version`.
- A published version cannot be replaced. If something is wrong, publish the
  fix as the next patch; only reach for `npm deprecate` (not unpublish) when a
  version is actively harmful.

[provenance]: https://docs.npmjs.com/generating-provenance-statements
