# MCP

```sh
ankou mcp
```

JSON-RPC on stdio. Nine tools, and the interesting thing about them is which
ones need a model: **one**.

```jsonc
// .mcp.json, or wherever your host keeps its servers
{
  "mcpServers": {
    "ankou": { "command": "npx", "args": ["-y", "ankou", "mcp"] }
  }
}
```

From a checkout, point it at the built CLI instead:

```jsonc
{ "mcpServers": { "ankou": { "command": "node", "args": ["packages/cli/dist/cli.js", "mcp"] } } }
```

There is no API key in any of this. The host is the model.

## Why the model half is handed back

ankou's pipeline is fixed: ingest, plan, window, ask, assemble, render. Under an
API provider, `ask` is a `fetch` to a vendor with the window in front of it and
nothing else. That is fine right up until the document points somewhere it
cannot follow — a spec citing RFC 7231 §6.5.1, a design doc naming an internal
service, a paper leaning on an acronym it introduced somewhere else. A model
asked to compose anyway does compose, plausibly, and the reader has no way to
tell which parts were read and which were assumed.

A host agent is not stuck like that. It can fetch the RFC, grep the repository,
ask the user. So over MCP, `ask` stops being a network call and becomes a
question handed to the caller:

```
ankou_carve_start  →  { state: "awaiting-model", request: { name, schema, prompt } }
                                     ↓  go and look things up
ankou_carve_answer →  { state: "done", piece }        …or the next request
```

Everything either side of that stays ankou's. The flipbook's body is still
sliced verbatim from the source rather than typed by a model. Params are still
clamped, windows still windowed, map-reduce still reduced, and the piece is
still validated before anything renders it. **Delegating composition does not
delegate the guarantees**, because the guarantees never lived in the model call.

## The tools

| tool | model? | what it is for |
| --- | --- | --- |
| `ankou_formats` | no | The format registry: what each shape is and what it is the right answer to. |
| `ankou_ingest` | no | Markdown, text, HTML, PDF, URLs → normalised text, headings, language. Returns a **map** of the document, not its body. |
| `ankou_read` | no | One window of that document, in the windows the pipeline uses. |
| `ankou_gaps` | no | What the document leans on but never explains: undefined acronyms, citations, links, pointers. |
| `ankou_carve_start` | **yours** | Run the pipeline with you as the model. Parks on the first question. |
| `ankou_carve_answer` | **yours** | Answer it. A shape the schema rejects costs a retry, not the carve. |
| `ankou_carve_cancel` | no | Abandon a run, or list what is open. |
| `ankou_validate` | no | What is missing in a piece, by the same check the renderers use. |
| `ankou_render` | no | Piece → a self-contained HTML page on disk. Returns the path, never the bytes. |

Two of those deserve their reasoning spelled out.

**`ankou_ingest` does not return the text.** A 200-page PDF in a tool result is a
200-page PDF in your context, and you were going to read it a window at a time
anyway. So ingest returns the shape — title, language, character counts,
sections, how many windows — and `ankou_read` returns a window when you want one.

**`ankou_render` does not return the HTML.** A rendered flipbook is 15–20KB of
markup whose entire purpose is to be opened in a browser. It goes to a file; you
get the path.

## The loop, end to end

```
ankou_ingest   { sources: ["./RFC.md"] }
   → { docId: "doc-1", documents: [...], windows: 3 }

ankou_gaps     { docId: "doc-1" }
   → [ { kind: "citation", text: "RFC 7231", count: 4, context: "…" },
       { kind: "acronym",  text: "MTBF",     count: 7, context: "…" } ]

   ← go and resolve the ones that matter, with whatever tools you have

ankou_carve_start  { sources: ["./RFC.md"], intent: "review this properly" }
   → { state: "awaiting-model", request: { name: "reading_plan", schema: {…} } }

ankou_carve_answer { carveId, output: { format: "summary", rationale: "…" } }
   → { state: "awaiting-model", request: { name: "summary_window", schema: {…} } }
   → … one per window …
   → { state: "done", format: "summary", piece: {…} }

ankou_render   { piece: carveId }
   → { path: "/tmp/ankou-x9f/piece.html", bytes: 8221 }
```

`intent` is the brief and it is read for tone, language and purpose — pass the
reader's own words rather than your summary of them. The rationale that comes
back is written for them, in their language, and is the natural thing to say
alongside the result.

## Notes for a host

- **Answer the schema exactly.** `request.schema` is the same JSON Schema an API
  provider's grammar would have been built from. Validation happens on the way
  in, and a rejection leaves the carve exactly where it was, with the errors.
- **Resolve gaps before you answer, not after.** The point of composing here is
  the looking-up. A quiz question about a cited RFC is worth writing after
  reading the RFC and not before.
- **Jobs live in memory** and are capped at eight; abandon one with
  `ankou_carve_cancel` if you change your mind.
- **`ankou_read` is for you, not for the pipeline.** The carve reads the source
  itself; reading a window is how you check what you are being asked about.

## When not to use this

If nothing needs looking up, the one-shot is cheaper in round trips and in your
context: `ankou <source> -i "…"` with any provider, or `carveAndRender()` from
the SDK with your own `llm`. The MCP path buys you exactly one thing — the
ability to go and find out — and on a self-contained document that is worth
nothing.
