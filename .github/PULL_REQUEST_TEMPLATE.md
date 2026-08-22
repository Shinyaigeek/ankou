## What changes for the reader

<!-- The user-visible difference, in a sentence or two. If nothing is visible to
     a user, say what is visible to a maintainer. -->

## How you verified it

<!-- The document and intent you ran it on, and what came out. For a rendering
     change, attach the before/after page. For a prompt or schema change: which
     provider and model, what got worse before, what got better after. -->

- [ ] `pnpm check`
- [ ] `pnpm build` and `pnpm typecheck`
- [ ] `pnpm test`
- [ ] Ran it against a real model, if this touches a prompt or a schema

## Notes

- [ ] One change — a fix and a refactor are two PRs
- [ ] No new runtime dependency in `kamu-core` (or the PR argues for it)
- [ ] Docs updated if a flag, format or SDK surface moved
- [ ] `CHANGELOG.md` updated under `Unreleased`, if a user would notice
