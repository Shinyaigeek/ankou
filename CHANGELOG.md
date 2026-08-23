# Changelog

Both packages — `ankou` (the CLI) and `ankou-core` (the SDK) — share a version and are released together. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[semver](https://semver.org/) with the pre-1.0 caveat that the format set, the
CLI flags and the `Piece` shapes may still move in a minor release.

## Unreleased

### Changed

- **Renamed: `kamu` is now `ankou`.** The old name was only ever available
  scoped, which made `npm i -g @shinyaigeek/kamu` install a command called
  something else. Both packages are unscoped now: **`ankou`** (the CLI) and
  **`ankou-core`** (the SDK), and the command is `ankou`.
  - 鮟鱇 — an anglerfish is too slippery to cut on a board, so it is hung up and
    taken apart from there, and every part goes out in the form that suits it.
  - The SDK entry points follow the metaphor: `chew` → `carve`,
    `chewAndRender` → `carveAndRender`, `chewPlan` → `carvePlan`, and
    `ChewOptions` → `CarveOptions`. A `Piece` is still a `Piece` — it is a cut.
  - `KAMU_PROVIDER` and `KAMU_MODEL` are now `ANKOU_PROVIDER` and `ANKOU_MODEL`;
    the config file moved from `~/.config/kamu/config.json` to
    `~/.config/ankou/config.json`; `KamuError` is `AnkouError`.
  - Nothing was ever published under the old names, so there is nothing to
    migrate and no deprecation to publish.

### Added

- **A site**: [shinyaigeek.github.io/ankou](https://shinyaigeek.github.io/ankou/),
  built from this repository on every push to `main`. Every format is embedded
  live on it, rendered by `examples/gallery.mjs`, so the tour cannot drift from
  what the renderers emit.

### Fixed

- **`--theme auto` follows the reader again.** The rendered HTML applied its
  dark palette to anyone without an explicit choice, including readers whose
  system asks for light: the dark block was missing its
  `prefers-color-scheme` guard.

## 0.1.0 — 2026-08-22

First public release.

### Added

- **Six formats.** `flipbook` plays a source back one character at a time,
  verbatim; `slides` is a deck; `quiz` grades you; `animation` is kinetic
  typography; `summary` runs TL;DR to open questions; `dialogue` is two voices
  working through the material.
- **Intent-driven planning.** `--intent` is the brief: a model reads it and
  picks the format, or `--format` skips the planner.
- **Sources**: markdown, plain text, HTML, PDF, URLs and stdin. A URL is
  reduced to its readable part by an in-tree extractor. Text is decoded by what
  the source declares, and a source that declares nothing and is not UTF-8 is
  refused rather than mangled — `--encoding` says it for them.
- **Three renderers** over one composed `Piece`: a self-contained HTML page, an
  interactive terminal player, and JSON. `ankou render piece.json` re-renders a
  saved piece onto another surface with no model and no network.
- **Four providers**: `anthropic`, `openai` (and anything OpenAI-compatible),
  `ollama`, and `claude-code` via the Claude Agent SDK. `ankou providers` reports
  which are ready on this machine.
- **The SDK**, `ankou-core`: `carve`, `carveAndRender`, the format
  registry and the renderers, with no runtime dependencies. Bring your own model
  — any object with a `complete` method works.

### Notes

- `flipbook` never lets the model write the body: it produces annotations only,
  and the text is sliced verbatim out of the source.
- PDF support (`unpdf`) and the Claude Code provider
  (`@anthropic-ai/claude-agent-sdk`) are optional peer dependencies, imported
  lazily.
