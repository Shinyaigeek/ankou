---
name: kamu
description: Run kamu on a real document — pick the shape, generate it, check it, hand back the page. Use when the user says "これ読みやすくして", "一字一句頭に入れたい", "この記事クイズにして", "スライドにして", "kamu で噛んで", "/kamu", when they point at a spec, paper, PDF or URL and say what they want out of it, or when a change to this repo needs trying on real material rather than only the stub-model tests.
---

# kamu

Two jobs, same commands:

- **Make something readable.** The user has a document and a want. Turn it into the shape
  that serves the want.
- **Dogfood a change.** `pnpm test` runs the pipeline against a stub model, which proves
  the shapes hold but says nothing about whether a real model fills them well. A prompt or
  schema change is not verified until it has been through a real model on real text.

## 1. Build before running anything

`dist/` is gitignored, so a fresh clone or a `git pull` leaves the binary stale or absent.
This is the most common way a run fails for a reason that has nothing to do with the code.

```bash
cd <repo> && pnpm install && pnpm build
```

Then either `kamu …` (a launcher on this machine points at this working copy) or
`node packages/cli/dist/cli.js …` anywhere the launcher is not installed. Both run the
working tree, so edits are live after a rebuild.

## 2. Pick the provider deliberately

```bash
kamu providers      # what is ready right now, and what the rest are missing
```

The two that need no API key differ enough that the choice changes how you work:

| | speed | quality | needs |
| --- | --- | --- | --- |
| `--provider claude-code` | **2–4 min a run** | good enough to show the user | nothing; the SDK is already a workspace peer |
| `--provider ollama` | seconds | depends entirely on the model | `ollama serve` running |

`claude-code` spawns a `claude` subprocess per model call, and a long document is windowed
into several. **Run it with `run_in_background: true`** — a foreground Bash call will hit
its timeout and tell you nothing about whether kamu worked.

For ollama, check what is actually pulled (`ollama list`) before promising anything. A 1B
model gets through the pipeline but writes quiz questions that get dropped as ungradeable
and glosses that are not worth reading; it is a smoke test, not a result.

## 3. Decide the shape before paying for it

```bash
kamu <source> -i "<what they want out of it>" --plan-only
```

One cheap model call, and none at all if you also pass `-f`. It prints the format, the
rationale and the params. Use it whenever the real run is `claude-code`, and whenever you
are unsure the intent reads the way you think it does.

Let the planner choose unless the user named a shape. Its whole job is reading intent, and
overriding with `-f` on a hunch is how you end up handing someone a deck when they asked to
read every word. Override when they were explicit, or when the plan comes back wrong.

`flipbook` is the one to reach for on "一字一句" / "read every word": the body is sliced
verbatim out of the source and the model only annotates, so fidelity is structural rather
than something the model promised.

## 4. Generate

```bash
kamu spec.md -i "一字一句漏らさず頭に入れたい" -o out.html      # html, the default
kamu post.md -i "覚えたい" --render json -o piece.json         # the structure, saved
kamu post.md -i "覚えたい" --render tui -o -                   # a plain transcript
```

On anything that cost a `claude-code` run, **save the piece** (`--render json -o
piece.json`) and change surfaces with `kamu render` afterwards:

```bash
kamu render piece.json -o out.html      # instant; no model, no network
kamu render piece.json --render tui -o -
```

Rendering is a pure function of the piece, so a second surface is free. Re-running
kamu to get the same content as HTML instead of JSON pays the model twice for one
answer, and gives you a *different* answer the second time.

Relative sources and `-o` resolve against the directory you are standing in. Write outputs
to the session scratchpad, never into the repo.

`--render tui` without a TTY prints a transcript instead of waiting for a keypress, so it
is safe to pipe — that is the fastest way to read a result yourself. `--play` is for the
user at their own terminal; do not run it expecting to see anything.

## 5. Read it before you hand it over

A run that exits 0 has produced a well-formed page, not necessarily a good one. Read the
saved piece — the JSON directly, or `kamu render piece.json --render tui -o -` for
something laid out — and check the thing the format promises:

- **flipbook** — is the body verbatim? grep a distinctive sentence from the source.
- **quiz** — every `answer` must be an id that appears in that question's `choices`.
- **dialogue** — do the turns alternate, and does the learner ask rather than explain?
- **slides / summary** — is it the source's argument, or a generic gloss of the topic?

Then send the file with `SendUserFile` (`display: "render"` for HTML — it opens in the side
panel). Say which format the planner picked and why; the rationale is written in the user's
own language and is usually worth quoting.

## What the errors mean

| message | what to do |
| --- | --- |
| `The model returned no usable questions` (or slides, scenes, dialogue, summary) | The model came back empty or unusable. Rerun, or move up to a bigger model. kamu refuses to write a page with nothing on it. |
| `The sources have no text to play back` | The source was empty or whitespace. Check ingestion first, not the model. |
| `Cannot reach Ollama at …` | `ollama serve` is not running. It is not a systemd service here. |
| `… did not return valid <name> JSON after two attempts` | The model could not fill the schema even with its own errors handed back. Almost always too small a model. |
| `No LLM provider configured` | Pass `--provider`, or set one in `~/.config/kamu/config.json`. |

## Working on kamu itself

`pnpm check && pnpm build && pnpm typecheck && pnpm test` is what CI runs; see
CONTRIBUTING.md. `node examples/gallery.mjs` renders one page per format from a fixed piece
with no model at all, which is the fast way to check a *renderer* change.

A prompt or schema change needs a real model and a real document, and the PR should say
what got worse before and better after. That is what this skill is for.
