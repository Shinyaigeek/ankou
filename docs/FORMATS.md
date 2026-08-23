# Formats

Every format is a `FormatModule` in `packages/core/src/formats/`. `ankou formats`
prints this list from the code, so it can never drift from what is installed.

## flipbook

Plays the source back one character at a time, verbatim.

- **Params:** `baseMs` — milliseconds per character, lower is faster. The planner
  sets this from how dense the writing is; 40–90 is comfortable.
- **The model only annotates.** Chapter titles, emphasis terms with short
  glosses, ruby readings, pacing. It never touches the body text.
- **HTML:** full-screen character stage with a running context strip, chapter
  sidebar (`c`), speed control (`↑`/`↓`), step (`←`/`→`, hold shift for 20).
- **TUI:** the same tape, revealed into wrapped text with the current character
  marked.

Punctuation and paragraph breaks get longer pauses than ordinary characters, and
emphasised terms are slowed slightly so they register.

## slides

- **Params:** `slideCount`, `tone`.
- Every headline is a claim the source makes, not a label. Optional focal
  element per slide: a verbatim quote, a stat, a code block, or mermaid source.
- **HTML:** keyboard deck, `n` toggles speaker notes, `f` fullscreen, deep-links
  by hash, and prints one slide per page with the notes visible.

## quiz

- **Params:** `questionCount`, `difficulty` (1 recall, 2 understanding, 3
  application).
- Single-choice, multi-choice and short answer. Each question carries an
  explanation and, where possible, a verbatim quote from the source that settles
  it.
- **HTML:** answer, submit, get graded, see what you missed and why.
- **TUI:** same, one question at a time, with a score at the end.

Short answers are compared after normalising case, whitespace (including
full-width) and trailing punctuation, against a list of accepted strings.

## animation

- **Params:** `sceneCount`, `pace`.
- Kinetic typography: scenes of one to four lines with a motion (`fade`,
  `slide-up`, `zoom`, `typewriter`, `stagger`, `flip`), a duration, a hold and a
  mood that sets the palette.
- **HTML:** auto-advancing player, click or space to pause, arrows to step.
- **TUI:** centred scenes on the same timing.

This is the one format that is allowed to be selective. It is cutting a trailer,
not writing a report.

## summary

- **Params:** `depth` — `brief` or `thorough`.
- Map-reduce over the document: per-window digests, then one final pass for the
  TL;DR and key points, so the top level reflects the whole thing.
- Produces TL;DR, key points, a per-section outline, a glossary of terms the
  source leans on, and the questions it raises without answering.
- **HTML:** a document you can print or keep.

## dialogue

- **Params:** `level` — `beginner`, `intermediate`, `expert`.
- Two speakers established in the first window and reused across the rest. The
  learner asks the awkward question and pushes back on hand-waving.
- **HTML:** transcript revealed one turn at a time (`space`; `a` reveals all),
  which keeps you in the conversation instead of scanning to the end.

## Adding a format

1. Write `packages/core/src/formats/<id>.ts` exporting a `FormatModule`: `id`,
   `label`, `description`, `bestFor`, `params`, and `compose`.
2. Add its `Piece` variant to `src/types.ts` and to the `Piece` union.
3. Register it in `src/formats/index.ts` and add its id to `FormatId`.
4. Add renderers: a case in `src/render/html/index.ts` and, if it needs more than
   the transcript pager, a branch in `src/render/tui/play.ts`.
5. Extend the stub in `packages/core/test/pipeline.test.ts` — the suite walks
   every registered format through every renderer, so a new one is covered the
   moment it is registered.

`description` and `bestFor` are not documentation: they are the planner's menu.
Write them for the model as much as for the reader.

`params` is the same kind of thing. Each knob declares a `type` and a
`description`, and the planner's schema is built from the registry, so a new knob
is settable the moment it is declared — there is no second list to keep in step.
That matters more than it looks: a provider's grammar drops any property the
schema does not declare and says nothing, so a knob missing from it would be one
the planner asks for and never receives.
