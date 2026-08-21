# SDK

```sh
npm i @shinyaigeek/kamu-core
```

ESM, Node 22+, no runtime dependencies.

## The two entry points

```ts
import { chew, chewAndRender } from '@shinyaigeek/kamu-core'

// ingest → plan → compose. Returns the structure.
const { piece, plan, documents } = await chew({ sources, intent })

// …and render in one call.
const { piece, plan, output } = await chewAndRender({ sources, intent, renderer: 'html' })
```

### Options

```ts
interface ChewOptions {
  intent: string                  // what the reader wants out of it
  sources: Source[]               // paths, URLs, or { content, name, kind }
  format?: FormatId               // skip the planner
  params?: Record<string, unknown>
  llm?: LLM                       // bring your own model
  provider?: 'anthropic' | 'openai' | 'ollama' | 'claude-code'
  providerOptions?: { model?, apiKey?, baseUrl?, maxTokens?, temperature?, fetchImpl?, headers? }
  lang?: string                   // force the output language
  windowChars?: number            // source characters per model call (default 24000)
  ingest?: { fetchImpl?, timeoutMs?, userAgent?, full? }
  onProgress?: (event: ProgressEvent) => void
  signal?: AbortSignal
}
```

With no `llm` and no `provider`, kamu reads `KAMU_PROVIDER`, then falls back to
whichever API key is present, and throws an actionable error if there is none.

## Sources

```ts
sources: [
  './notes.md',                                  // path, kind from extension
  'https://example.com/post',                    // fetched and extracted
  { content: markdown, name: 'inline.md' },      // already in memory
  { path: './weird.dat', kind: 'markdown' },     // override the guess
]
```

Ingest is available on its own if you only want normalised text:

```ts
import { ingest, ingestAll } from '@shinyaigeek/kamu-core'

const document = await ingest('https://example.com/post')
document.title, document.text, document.sections, document.lang
```

## Pieces

`chew()` returns a `Piece`: a discriminated union on `format`, fully typed.

```ts
const { piece } = await chew({ sources, intent, format: 'quiz' })
if (piece.format === 'quiz') {
  for (const question of piece.questions) {
    question.prompt, question.choices, question.answer, question.explanation
  }
}
```

A `Piece` is plain JSON. Persist it, cache it, send it to a browser, hand it to
another agent — and render it later without touching a model again.

## Rendering

```ts
import { render, playTui } from '@shinyaigeek/kamu-core'

render(piece, 'html', { theme: 'dark' })   // { content, ext, mime, renderer }
render(piece, 'json')
render(piece, 'tui', { columns: 100 })     // a transcript

await playTui(piece)                       // interactive; needs a TTY
```

`render` is a pure function. It never calls a model, never touches the network,
and is safe to run on a server for every request.

## Bringing your own model

```ts
import type { LLM } from '@shinyaigeek/kamu-core'

const myModel: LLM = {
  name: 'my-gateway:some-model',
  async complete({ system, prompt, maxTokens, temperature, signal }) {
    return await callMyGateway({ system, prompt, maxTokens, temperature, signal })
  },
  // Optional. Omit it and kamu prompts for JSON, validates, and retries once
  // with the validator's errors — which is enough for most models.
  async structured({ name, schema, prompt, system }) {
    return await callMyGatewayWithSchema({ name, schema, prompt, system })
  },
}

await chew({ sources, intent, llm: myModel })
```

The built-in providers are also exported directly if you want to configure one
and reuse it:

```ts
import { anthropic, claudeCode, ollama, openai } from '@shinyaigeek/kamu-core'

const llm = openai({ baseUrl: 'http://localhost:1234/v1', model: 'local-model' })
```

## Progress and cancellation

```ts
const controller = new AbortController()

await chew({
  sources,
  intent,
  signal: controller.signal,
  onProgress: ({ stage, message }) => console.error(`${stage}: ${message}`),
})
```

Stages are `ingest`, `plan`, `compose`, `render`. On a long document the compose
stage reports which window it is on.

## Errors

Everything kamu throws deliberately is a `KamuError` with a `code`
(`INGEST | LLM | COMPOSE | CONFIG`), a message, and usually a `hint` that says
what to do about it.

```ts
import { KamuError } from '@shinyaigeek/kamu-core'

try {
  await chew({ sources, intent })
} catch (error) {
  if (error instanceof KamuError) console.error(error.message, error.hint)
  else throw error
}
```

## Embedding: a worked example

Wiring kamu into a chat agent as a tool. The agent already knows what the user
asked for, so it passes that straight through as the intent, and returns HTML for
the client to render inline.

```ts
import { chewAndRender, FORMAT_IDS } from '@shinyaigeek/kamu-core'

export const readTool = {
  name: 'reshape_document',
  description:
    'Reshape one or more documents (markdown, text, HTML, PDF, URL) into the form ' +
    'the user wants to consume them in. Returns a self-contained HTML page.',
  parameters: {
    type: 'object',
    properties: {
      sources: { type: 'array', items: { type: 'string' } },
      intent: { type: 'string', description: "What the user wants out of it, in their words." },
      format: { type: 'string', enum: FORMAT_IDS, description: 'Optional; omit to let kamu choose.' },
    },
    required: ['sources', 'intent'],
  },

  async run({ sources, intent, format }, { signal }) {
    const { piece, plan, output } = await chewAndRender({
      sources,
      intent,
      ...(format ? { format } : {}),
      renderer: 'html',
      signal,
    })
    return {
      format: piece.format,
      rationale: plan.rationale,   // show the user why this shape
      html: output.content,
      // Keep the piece if you want to re-render later without paying again.
      piece,
    }
  },
}
```

Notes for that setup:

- **Reuse the host's model.** Pass `llm` rather than `provider` so kamu bills and
  rate-limits through the same client as the rest of the app.
- **Store the `Piece`, not the HTML.** It is smaller, it is queryable, and every
  other renderer is one pure call away.
- **`plan.rationale` is written for the user**, in their language. It is the
  natural thing to say back to them alongside the result.
- **Long sources are windowed already**, but `windowChars` is worth lowering for
  small local models.
