# Architecture

kamu is a four-stage pipeline with one typed artefact in the middle.

```
Source[] ──ingest──▶ Document[] ──plan──▶ Plan ──compose──▶ Piece ──render──▶ text
```

Each stage is independently usable. `chew()` runs the first three; `render()` and
`playTui()` are the fourth.

## Ingest — `src/ingest/`

Turns anything into a `Document`: normalised text, section headings, a language
tag, and provenance. **The text is never rewritten** — no model runs in this
stage — because downstream formats (flipbook above all) depend on the source
surviving intact.

- `markdown.ts` — front matter, fence-aware heading split, syntax stripped down
  to what a reader would say out loud.
- `text.ts` — infers sections from typography: a short, unterminated line
  followed by a blank one reads as a heading.
- `html-parse.ts` — a ~200-line tolerant tokenizer and tree builder. Not
  spec-compliant, deliberately: no scripting, no adoption agency. It exists so
  the package can stay dependency-free.
- `html.ts` — Readability-style extraction. Boilerplate elements and
  `nav|footer|share|cookie`-ish class names are pruned, then candidate
  containers are scored on text length discounted by link density, with
  paragraph and comma counts as prose signals. The winner is serialised to light
  markdown.
- `pdf.ts` — `unpdf` (optional peer) for extraction, then reflow: PDF text
  carries a hard break at every typeset line, so lines running the full measure
  are joined as continuations and a short line ends its paragraph.
- `index.ts` — dispatch, sniffing (extension → MIME → content), and URL fetching
  with a timeout.

## Plan — `src/plan.ts`

One model call. It sees the reader's intent, a profile of each document (title,
length, language, outline, opening) and the format menu — descriptions, what
each is good for, and the knobs each accepts — and returns a `format`, a
`rationale` written in the reader's language, and `params`.

`--format` skips this call entirely. `guessFormat()` is a keyword fallback for
callers that want a shape without spending anything.

## Compose — `src/formats/`

Each format is a `FormatModule`: metadata for the planner's menu, plus a
`compose(context)` that returns its `Piece` variant.

Long sources are split by `mapWindows` into character-budgeted windows on
paragraph boundaries, mapped per window, and merged. `summary` additionally
reduces: per-window digests go back into one final call for the TL;DR and key
points, so the top level sees the whole document rather than its first chunk.

Every model call goes through `ask()`, which uses native structured output where
the provider has it and otherwise prompts, extracts, validates, and retries once
with the validator's own error messages.

### Why flipbook is different

Its promise is *every character*. A model that writes the body cannot keep that
promise, so it never gets to: `chaptersFromDocuments` slices chapters verbatim
out of the ingested text (merging runs of tiny sections, or cutting on paragraph
boundaries near a target length when there are no headings), and the single model
call only produces annotations — chapter titles, emphasis terms, ruby readings,
pacing. The renderer explodes the verbatim text into grapheme clusters at
playback time.

## Piece — `src/types.ts`

A discriminated union on `format`. This is the boundary: everything upstream
talks to a model, everything downstream is a pure function. It is what makes
"one model call, many surfaces" true, and it is the natural thing to persist,
cache, or ship over the wire to a UI.

## Render — `src/render/`

- `html/` — one self-contained file per format. Shared shell with design tokens,
  a three-state theme (explicit dark, explicit light, system default), a JSON
  island for data, and client scripts written without template literals so they
  inline cleanly. No CDN, no fonts fetched, no build step.
- `tui/` — `term.ts` has the primitives, including a display-width table so
  Japanese wraps correctly. `text.ts` renders a transcript for pipes and CI;
  `play.ts` is the interactive player: alternate screen buffer, raw mode, a
  hand-rolled key decoder, and a per-format loop (character playback, paging,
  timed scenes, or an actual graded quiz).
- `json` — the `Piece`, pretty-printed.

`render()` covers html/tui/json as strings. `playTui()` is separate because an
interactive session is not a string.

## LLM — `src/llm/`

A provider implements `complete` and optionally `structured`:

- `anthropic.ts` — Messages API over `fetch`, forced tool use for structured
  output.
- `openai.ts` — any OpenAI-compatible `/chat/completions`, `json_schema`
  response format with a prompt fallback for endpoints that ignore it.
- `ollama.ts` — local daemon, schema in `format`.
- `claude-code.ts` — the Claude Agent SDK (optional peer, lazily imported), for
  people who have a Claude Code subscription and no API key.

`schema/validate.ts` is a small JSON Schema validator covering exactly the
keywords kamu's own schemas use. Its job is not general validation — it is to
describe a model's drift precisely enough that the model can fix it.

## What is deliberately not here

- **No streaming.** A piece is composed, then rendered. Progress is reported
  through `onProgress`, but partial pieces are not a thing.
- **No caching layer.** `chew()` is a pure-ish function of (sources, intent,
  model); callers who want to cache should cache the `Piece`.
- **No plugin loader.** Adding a format is adding a file to `src/formats/` and a
  line to its registry. Runtime-loaded formats would mean shipping a sandbox.
