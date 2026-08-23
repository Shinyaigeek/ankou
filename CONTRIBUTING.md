# Contributing to ankou

Thanks for taking the time. ankou is a pnpm monorepo of two packages, and the bar
for a change is: it builds, it type-checks, it passes lint, and the suite stays
green.

## Prerequisites

- **Node 22 or newer** (`engines`); `.nvmrc` pins what development uses.
- **pnpm** — the version is declared in `packageManager`; `corepack enable`
  provisions it.

No API key is needed to develop. The test suite and the example gallery both run
the whole pipeline against a stub model.

## Setup

```sh
pnpm install
pnpm build
pnpm test
node examples/gallery.mjs      # writes examples/out/*.html — open them
```

## The checks CI runs

```sh
pnpm check       # biome lint + format
pnpm build       # tsc across every package
pnpm typecheck   # tsc --noEmit
pnpm test        # every package's suite: the pipeline against a stub model,
                 # ingestion, and the CLI's argument parsing
```

`pnpm check:fix` applies the formatter and safe lint fixes.

## Working in the monorepo

- `packages/core` is the engine and the published SDK. `packages/cli` is a thin
  wrapper: argument parsing, config, progress output, file writing.
- **`ankou-core` has no runtime dependencies, and that is a feature.** A change
  that adds one needs to argue for itself in the PR. PDF support and the Claude
  Agent SDK are optional peers, imported lazily, and everything else works
  without them.
- Install scripts are blocked by default. A dependency that genuinely needs one
  goes in `allowBuilds` in `pnpm-workspace.yaml`, with the reason in the PR.

## Adding a format

See [docs/FORMATS.md](./docs/FORMATS.md#adding-a-format). The short version: one
file in `src/formats/`, a `Piece` variant, a registry line, and renderers. The
test suite walks every registered format through every renderer automatically,
so registering it is what puts it under test.

Note that a format's `description` and `bestFor` are the planner's menu, not
documentation. Vague ones make the planner worse.

## Prompt changes

Prompts are code here. If you change one:

- say what got worse before, and what got better after, on a real document;
- keep the schema and the prompt in the same PR — they are one interface;
- do not add "be helpful"-style padding. Every line in a prompt should change an
  output.

The test suite runs against a stub model, so it proves the shapes hold and says
nothing about whether a real model fills them well. `.claude/skills/ankou/` drives
a real run end to end — which provider to reach for, how to check the result, and
what each failure means — if you work with Claude Code.

## Pull requests

- One change per PR. A bug fix and a refactor are two PRs.
- Match the surrounding code: terse, explicit, comments explain *why*.
- Describe the user-visible change and how you verified it. For a rendering
  change, attach the before/after page.

## Reporting bugs

An issue with the source document (or a link to it) and the intent you passed is
worth ten paragraphs of description. If the output was wrong rather than broken,
`--render json` output is the most useful thing you can attach.

## Security

Please **do not** open a public issue for a vulnerability. See
[SECURITY.md](./SECURITY.md).

## Changelog and releases

Anything a user would notice goes in [CHANGELOG.md](./CHANGELOG.md) under
`Unreleased`, in the same PR as the change. Cutting a release is a maintainer
job and lives in [docs/RELEASING.md](./docs/RELEASING.md): both packages share a
version, and a `v*` tag publishes them.

## License

By contributing, you agree that your contributions are licensed under the
project's [MIT License](./LICENSE).
