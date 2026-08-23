# ankou

[![CI](https://github.com/Shinyaigeek/ankou/actions/workflows/ci.yml/badge.svg)](https://github.com/Shinyaigeek/ankou/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/ankou?label=ankou)](https://www.npmjs.com/package/ankou)
[![npm](https://img.shields.io/npm/v/ankou-core?label=ankou-core)](https://www.npmjs.com/package/ankou-core)
[![license](https://img.shields.io/npm/l/ankou)](./LICENSE)

> 鮟鱇 — an anglerfish is too slippery and shapeless to cut on a board, so it is
> hung up and taken apart from there. Liver, skin, fins, flesh, stomach: every
> part goes out in the form that suits it, and nothing is thrown away.

**[shinyaigeek.github.io/ankou](https://shinyaigeek.github.io/ankou/)** — the tour,
with every format rendered live on the page.

You have a spec, a PDF, a long blog post. What you want out of it is not always
"the text, top to bottom": sometimes it is *every single character, slowly*.
Sometimes it is a deck, or a quiz you have to pass, or four seconds of kinetic
type that make one idea land.

ankou does that to documents. It takes the sources **and what you want out of
them**, picks the shape, and gives it back as something you can actually read.

```sh
ankou spec.md --intent "一字一句漏らさず頭に入れたい"
# → flipbook: plays the text back one character at a time, verbatim

ankou https://example.com/post --intent "I need to remember this" --play
# → quiz, in your terminal

ankou paper.pdf notes.md --intent "explain it to me like I have never seen it"
# → dialogue: two voices working through it
```

Ships as a CLI **and** an SDK, because half the point is embedding it in
something else.

---

## Install

```sh
npm i -g ankou       # the command is `ankou`
```

Node 22+.

For the SDK, in a project:

```sh
npm i ankou-core
```

Or from a checkout, which is also how you develop on it:

```sh
git clone https://github.com/Shinyaigeek/ankou.git
cd ankou
./scripts/install-local.sh          # builds, then links ~/.local/bin/ankou
```

`BIN_DIR=/usr/local/bin ./scripts/install-local.sh` links it somewhere else, and
`git pull && pnpm build` keeps the linked command current. To run it without
putting anything on PATH: `pnpm build && pnpm ankou <args>`.

Optional extras — a checkout already has both; install them next to ankou if you
need what they unlock:

```sh
npm i unpdf                              # PDF sources
npm i @anthropic-ai/claude-agent-sdk     # --provider claude-code
```

Then point it at a model:

```sh
export ANTHROPIC_API_KEY=sk-...          # the default provider
# or --provider claude-code  → uses a Claude Code subscription, no key
# or --provider openai       → OpenAI, OpenRouter, LM Studio, vLLM, Groq
# or --provider ollama       → local, free, no network egress
```

`ankou providers` says which of those are ready on this machine and what the rest
are still missing. Start there if a run stops for want of a model.

## What it does

```
sources ──▶ ingest ──▶ plan ──▶ compose ──▶ render
 md              │        │         │          ├─ html   self-contained page
 txt             │        │         │          ├─ tui    interactive terminal
 html            │        │         │          └─ json   the raw structure
 pdf             │        │         │
 url             │        │         └── an LLM fills in a format-specific schema
                 │        └── an LLM reads your intent and picks the shape
                 └── normalised text, headings, language — never rewritten
```

The middle artefact is a **Piece**: a typed, format-specific structure. Renderers
are pure functions of a Piece, so the same carved result can be played in a
terminal, opened in a browser, or handed to another program as JSON without
asking the model to do the work twice.

```sh
ankou paper.pdf -i "覚えたい" --render json -o piece.json   # once, with a model
ankou render piece.json --open                              # and again, and again
```

## The formats

| Format | What it is | Reach for it when |
| --- | --- | --- |
| `flipbook` | The source played back **one character at a time**, verbatim, with emphasis and ruby | You want to actually read it, not skim it |
| `slides` | A deck: one claim per slide, bullets, speaker notes | You want the shape of the argument, fast |
| `quiz` | Questions, answers, explanations, a quote from the source | You need it to stick |
| `animation` | Kinetic typography — timed, moving text | You want an idea to land, or to share it |
| `summary` | TL;DR → key points → per-section outline → glossary → open questions | You are deciding whether to read the whole thing |
| `dialogue` | Two voices, one explaining and one pushing back | You keep bouncing off the material |

`ankou formats` prints this with the knobs each one takes.

### Flipbook never paraphrases

The interesting constraint in this repo. For a format whose whole promise is
*一字一句* — every character — you cannot let a language model write the body.

So it doesn't. The model gets to produce **annotations only**: chapter titles,
terms worth emphasising, readings for hard words, and a reading pace. The text
itself is sliced verbatim out of the source and exploded into grapheme clusters
by the renderer. Fidelity is structural, not a promise the model has to keep —
nothing is thrown away, because nothing was ever the model's to throw.

## Usage

```sh
ankou <source...> --intent "<what you want out of it>" [options]
```

Sources are file paths, URLs, or `-` for stdin. A URL is fetched and stripped
down to the readable part (a dependency-free Readability-style extractor, so
navigation and cookie banners do not end up in your flipbook).

Text is decoded by what the source declares — a BOM, a `Content-Type`, a
`<meta charset>` — and a source that declares nothing and is not UTF-8 is
refused rather than mangled. `--encoding shift_jis` says it for them.

```sh
-i, --intent <text>    What you want out of it. This is the brief.
-f, --format <id>      Skip the planner and pick the shape yourself.
-r, --render <id>      html | tui | json          (default: html)
-o, --out <file>       Where to write; "-" for stdout.
    --open             Open the result when it is written.
    --play             Shorthand for --render tui.
-p, --provider <id>    anthropic | openai | ollama | claude-code
-m, --model <id>       Model name for that provider.
    --param k=v        Format knob, repeatable: --param slideCount=12
    --encoding <name>  Character encoding for a source that declares none.
    --plan-only        Print what it would make and stop, without making it.

`ankou render <piece.json>` renders a piece saved earlier onto another surface.
No model, no network, no waiting.
```

Config lives at `~/.config/ankou/config.json`; flags beat environment beats file.

### In the terminal

`--play` opens an interactive player: the flipbook runs character by character
with speed control, the deck pages, the quiz actually grades you. Piped or
redirected, the same renderer emits a plain transcript instead — nothing hangs
waiting for a keypress that will not come.

### In a browser

The default. One HTML file, no CDN, no fonts to fetch, no build step. It works
offline, follows the reader's colour scheme, prints sensibly, and you can mail it
to someone.

## SDK

```ts
import { carveAndRender } from 'ankou-core'

const { piece, plan, output } = await carveAndRender({
  sources: ['./spec.md', 'https://example.com/post'],
  intent: '一字一句漏らさず頭に入れたい',
  renderer: 'html',
})

plan.format      // 'flipbook'
plan.rationale   // why it chose that, in your language
output.content   // the HTML
```

Bring your own model — anything with a `complete` method works, and ankou will
prompt-and-validate its way to structured output if the provider has no native
support:

```ts
await carve({ sources, intent, llm: myModel })
```

Stop before rendering if you want the structure instead of a page — for feeding
a UI, a database, or another agent:

```ts
const { piece } = await carve({ sources, intent, format: 'quiz' })
piece.questions   // fully typed
```

See [docs/SDK.md](./docs/SDK.md) for the full surface and an integration example.

## Examples

```sh
pnpm build && node examples/gallery.mjs   # writes examples/out/*.html
```

One page per format, rendered from a fixed piece with a stub model — no API key,
no tokens, just what each format looks like.

## Design notes

- **`ankou-core` has no runtime dependencies.** Providers are `fetch` calls;
  the HTML extractor, the JSON Schema validator and the terminal layer are all
  in-tree. PDF and the Claude Agent SDK are optional peers, imported lazily.
- **Composition and rendering are separate.** One model call, many surfaces.
- **Long documents are windowed**, mapped per window and reduced, so a 200-page
  PDF and a 400-word post go down the same path.
- **The model fills schemas, it does not emit prose-with-JSON-in-it.** Where a
  provider supports tool use or structured output, ankou uses it; where it does
  not, output is parsed, validated, and handed back with its own errors once.

More in [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md).

## Status

Early: 0.x, and the format set, the CLI flags and the `Piece` shapes may still
move in a minor release. [CHANGELOG.md](./CHANGELOG.md) says what changed;
[docs/RELEASING.md](./docs/RELEASING.md) says how a release is cut.

Every format has been run end to end against a real model; the providers, the
pipeline and the renderers are covered by `pnpm test`.

Contributions welcome — [CONTRIBUTING.md](./CONTRIBUTING.md) for the setup and
the bar, [SECURITY.md](./SECURITY.md) before reporting anything security-shaped.

## License

[MIT](./LICENSE)
