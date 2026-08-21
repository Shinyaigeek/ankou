# kamu

> 噛む — chew a document into the shape you actually want to read it in.

You have a spec, a PDF, a long blog post. What you want out of it is not always
"the text, top to bottom": sometimes it is *every single character, slowly*.
Sometimes it is a deck, or a quiz you have to pass, or four seconds of kinetic
type that make one idea land.

kamu takes the sources **and what you want out of them**, picks the shape, and
gives it back to you as something you can actually read.

```sh
kamu spec.md --intent "一字一句漏らさず頭に入れたい"
# → flipbook: plays the text back one character at a time, verbatim

kamu https://example.com/post --intent "I need to remember this" --play
# → quiz, in your terminal

kamu paper.pdf notes.md --intent "explain it to me like I have never seen it"
# → dialogue: two voices working through it
```

Ships as a CLI **and** an SDK, because half the point is embedding it in
something else.

---

## Install

```sh
npm i -g kamu            # the CLI
npm i @shinyaigeek/kamu-core   # the SDK
```

Node 22+. Optional extras, installed only if you need them:

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
are pure functions of a Piece, so the same chewed result can be played in a
terminal, opened in a browser, or handed to another program as JSON without
asking the model to do the work twice.

## The formats

| Format | What it is | Reach for it when |
| --- | --- | --- |
| `flipbook` | The source played back **one character at a time**, verbatim, with emphasis and ruby | You want to actually read it, not skim it |
| `slides` | A deck: one claim per slide, bullets, speaker notes | You want the shape of the argument, fast |
| `quiz` | Questions, answers, explanations, a quote from the source | You need it to stick |
| `animation` | Kinetic typography — timed, moving text | You want an idea to land, or to share it |
| `summary` | TL;DR → key points → per-section outline → glossary → open questions | You are deciding whether to read the whole thing |
| `dialogue` | Two voices, one explaining and one pushing back | You keep bouncing off the material |

`kamu formats` prints this with the knobs each one takes.

### Flipbook never paraphrases

The interesting constraint in this repo. For a format whose whole promise is
*一字一句* — every character — you cannot let a language model write the body.

So it doesn't. The model gets to produce **annotations only**: chapter titles,
terms worth emphasising, readings for hard words, and a reading pace. The text
itself is sliced verbatim out of the source and exploded into grapheme clusters
by the renderer. Fidelity is structural, not a promise the model has to keep.

## Usage

```sh
kamu <source...> --intent "<what you want out of it>" [options]
```

Sources are file paths, URLs, or `-` for stdin. A URL is fetched and stripped
down to the readable part (a dependency-free Readability-style extractor, so
navigation and cookie banners do not end up in your flipbook).

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
    --plan-only        Print what it would make, and stop.
```

Config lives at `~/.config/kamu/config.json`; flags beat environment beats file.

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
import { chewAndRender } from '@shinyaigeek/kamu-core'

const { piece, plan, output } = await chewAndRender({
  sources: ['./spec.md', 'https://example.com/post'],
  intent: '一字一句漏らさず頭に入れたい',
  renderer: 'html',
})

plan.format      // 'flipbook'
plan.rationale   // why it chose that, in your language
output.content   // the HTML
```

Bring your own model — anything with a `complete` method works, and kamu will
prompt-and-validate its way to structured output if the provider has no native
support:

```ts
await chew({ sources, intent, llm: myModel })
```

Stop before rendering if you want the structure instead of a page — for feeding
a UI, a database, or another agent:

```ts
const { piece } = await chew({ sources, intent, format: 'quiz' })
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

- **`kamu-core` has no runtime dependencies.** Providers are `fetch` calls;
  the HTML extractor, the JSON Schema validator and the terminal layer are all
  in-tree. PDF and the Claude Agent SDK are optional peers, imported lazily.
- **Composition and rendering are separate.** One model call, many surfaces.
- **Long documents are windowed**, mapped per window and reduced, so a 200-page
  PDF and a 400-word post go down the same path.
- **The model fills schemas, it does not emit prose-with-JSON-in-it.** Where a
  provider supports tool use or structured output, kamu uses it; where it does
  not, output is parsed, validated, and handed back with its own errors once.

More in [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md).

## Status

Early. The format set, the CLI flags and the `Piece` shapes may still move.
Pinning an exact version is wise until 1.0.

## License

[MIT](./LICENSE)
