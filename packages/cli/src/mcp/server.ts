import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  type Document,
  FORMAT_IDS,
  FORMATS,
  type FormatId,
  gaps,
  ingestAll,
  isFormatId,
  isPiece,
  isRendererId,
  type Piece,
  pieceProblems,
  RENDERERS,
  type RendererId,
  render,
  type Source,
  windows,
} from 'ankou-core'
import * as job from './jobs.js'
import { MethodError, RPC, type RpcRequest, serve } from './rpc.js'

/**
 * ankou as a set of tools for a host that has its own model.
 *
 * The split down the middle of this file is the whole idea. Everything above
 * `ankou_carve_start` runs without a model at all — ingesting, mapping, listing
 * leads, validating, rendering — and is where ankou's actual value lives. The
 * carve tools hand the model half out to the caller, one schema-shaped question
 * at a time, so the answers can be written by something that can go and look
 * things up first.
 */

const PROTOCOL = '2025-06-18'
const VERSION = '0.1.0'

interface Tool {
  name: string
  title: string
  description: string
  inputSchema: Record<string, unknown>
  run: (input: Record<string, unknown>) => Promise<unknown> | unknown
}

const str = (description: string) => ({ type: 'string', description })
const strings = (description: string) => ({ type: 'array', items: { type: 'string' }, description })

/** Documents live for the session so a caller can read them window by window. */
const documents = new Map<string, Document[]>()
let ingested = 0

function requireDocs(id: unknown): Document[] {
  const found = typeof id === 'string' ? documents.get(id) : undefined
  if (!found) throw new Error(`No document called \`${String(id)}\`. Call ankou_ingest first.`)
  return found
}

function sourcesFrom(input: unknown): Source[] {
  if (!Array.isArray(input) || input.length === 0) {
    throw new Error('`sources` must be a non-empty array of paths or URLs.')
  }
  return input.map((entry) => {
    if (typeof entry === 'string') return entry
    if (entry && typeof entry === 'object') return entry as Source
    throw new Error('Each source is a path, a URL, or {content, name}.')
  })
}

function pieceFrom(input: unknown): Piece {
  if (typeof input === 'string') {
    const kept = job.pieceOf(input)
    if (!kept) throw new Error(`No finished carve called \`${input}\`.`)
    return kept
  }
  if (!isPiece(input)) {
    throw new Error(`Not a renderable piece: ${pieceProblems(input).join(', ')}`)
  }
  return input
}

async function writeOut(content: string, ext: string, out: unknown): Promise<string> {
  if (typeof out === 'string' && out) {
    await writeFile(out, content, 'utf8')
    return out
  }
  const dir = await mkdtemp(join(tmpdir(), 'ankou-'))
  const path = join(dir, `piece.${ext}`)
  await writeFile(path, content, 'utf8')
  return path
}

/** What a parked or finished carve looks like to the caller. */
function report(id: string, settled: job.Settled): unknown {
  if (settled.kind === 'error') throw new Error(settled.error.message)
  if (settled.kind === 'done') {
    return {
      carveId: id,
      state: 'done',
      format: settled.result.piece.format,
      rationale: settled.result.plan.rationale,
      piece: settled.result.piece,
      next: 'Render it with ankou_render, passing this carveId or the piece itself.',
      progress: settled.progress,
    }
  }
  return {
    carveId: id,
    state: 'awaiting-model',
    request: settled.request,
    next:
      'Answer it with ankou_carve_answer. The output must satisfy `request.schema` exactly. ' +
      'Look anything up that the text assumes and you do not know before you answer — that is ' +
      'the point of composing here rather than inside ankou.',
    progress: settled.progress,
  }
}

const TOOLS: Tool[] = [
  {
    name: 'ankou_formats',
    title: 'List the shapes ankou can produce',
    description:
      'The format registry: id, what each one is, what it is the right answer to, and its knobs. ' +
      'This is the menu the planner picks from; read it before forcing a format.',
    inputSchema: { type: 'object', properties: {} },
    run: () =>
      FORMAT_IDS.map((id) => ({
        id,
        label: FORMATS[id].label,
        description: FORMATS[id].description,
        bestFor: FORMATS[id].bestFor,
        params: FORMATS[id].params,
      })),
  },
  {
    name: 'ankou_ingest',
    title: 'Read sources into normalised text',
    description:
      'Fetch and normalise markdown, text, HTML, PDF or URLs into plain text, headings and ' +
      'language — never rewritten, no model involved. Returns a map of the document rather than ' +
      'its body: read the body a window at a time with ankou_read, so a 200-page PDF does not ' +
      'land in your context all at once.',
    inputSchema: {
      type: 'object',
      properties: {
        sources: strings('Paths, URLs, or "-" is not accepted here; pass content inline instead.'),
        encoding: str('Character encoding for sources that declare none, e.g. shift_jis.'),
        full: { type: 'boolean', description: 'Keep the whole HTML page instead of extracting.' },
      },
      required: ['sources'],
    },
    run: async (input) => {
      const docs = await ingestAll(sourcesFrom(input.sources), {
        ...(typeof input.encoding === 'string' ? { encoding: input.encoding } : {}),
        ...(input.full === true ? { full: true } : {}),
      })
      ingested += 1
      const id = `doc-${ingested}`
      documents.set(id, docs)
      return {
        docId: id,
        documents: docs.map((document) => ({
          title: document.title,
          origin: document.origin,
          lang: document.lang,
          charCount: document.charCount,
          sections: document.sections.map((section) => ({
            title: section.title,
            charCount: section.text.length,
          })),
        })),
        windows: windows(docs.map((document) => document.text).join('\n\n'), 24_000).length,
      }
    },
  },
  {
    name: 'ankou_read',
    title: 'Read one window of an ingested document',
    description:
      'The text itself, a window at a time, in the same windows the pipeline uses. Use it to ' +
      'read what you are composing from without pulling the whole document into context.',
    inputSchema: {
      type: 'object',
      properties: {
        docId: str('From ankou_ingest.'),
        window: { type: 'integer', description: 'Zero-based window index. Default 0.' },
        windowChars: { type: 'integer', description: 'Characters per window. Default 24000.' },
      },
      required: ['docId'],
    },
    run: (input) => {
      const docs = requireDocs(input.docId)
      const size = typeof input.windowChars === 'number' ? input.windowChars : 24_000
      const parts = windows(docs.map((document) => document.text).join('\n\n'), size)
      const index = typeof input.window === 'number' ? input.window : 0
      const text = parts[index]
      if (text === undefined) {
        throw new Error(`Window ${index} of ${parts.length} does not exist.`)
      }
      return { window: index, windows: parts.length, text }
    },
  },
  {
    name: 'ankou_gaps',
    title: 'What the document leans on but never explains',
    description:
      'Undefined acronyms, citations, links and pointers to material that is not in the sources — ' +
      'found without a model. These are the things a composer would otherwise guess at, so ' +
      'resolve the ones that matter before you answer a carve request.',
    inputSchema: {
      type: 'object',
      properties: {
        docId: str('From ankou_ingest.'),
        minCount: { type: 'integer', description: 'Drop leads mentioned fewer times than this.' },
        limit: { type: 'integer', description: 'Most leads to return. Default 40.' },
      },
      required: ['docId'],
    },
    run: (input) =>
      gaps(requireDocs(input.docId), {
        ...(typeof input.minCount === 'number' ? { minCount: input.minCount } : {}),
        ...(typeof input.limit === 'number' ? { limit: input.limit } : {}),
      }),
  },
  {
    name: 'ankou_carve_start',
    title: 'Start a carve that you supply the model for',
    description:
      "Runs ankou's pipeline — ingest, plan, window, assemble — with you as the model. It stops " +
      'at each point it would have called one and hands you the exact schema and prompt. ' +
      "Everything ankou refuses to let a model do stays ankou's: the flipbook body is still " +
      'sliced from the source, params are still clamped, and the piece is still validated.',
    inputSchema: {
      type: 'object',
      properties: {
        sources: strings('Paths or URLs.'),
        intent: str('What the reader wants out of it, in their words. This is the brief.'),
        format: {
          type: 'string',
          enum: FORMAT_IDS,
          description: 'Optional; omit to let ankou plan.',
        },
        params: { type: 'object', description: 'Format knobs, e.g. {"slideCount": 12}.' },
        lang: str('Force the output language, e.g. ja.'),
        windowChars: { type: 'integer', description: 'Source characters per model call.' },
      },
      required: ['sources', 'intent'],
    },
    run: async (input) => {
      if (
        input.format !== undefined &&
        !(typeof input.format === 'string' && isFormatId(input.format))
      ) {
        throw new Error(`Unknown format \`${String(input.format)}\`.`)
      }
      const { id, settled } = job.start({
        sources: sourcesFrom(input.sources),
        intent: String(input.intent ?? ''),
        ...(input.format ? { format: input.format as FormatId } : {}),
        ...(input.params && typeof input.params === 'object'
          ? { params: input.params as Record<string, unknown> }
          : {}),
        ...(typeof input.lang === 'string' ? { lang: input.lang } : {}),
        ...(typeof input.windowChars === 'number' ? { windowChars: input.windowChars } : {}),
      })
      return report(id, await settled)
    },
  },
  {
    name: 'ankou_carve_answer',
    title: 'Answer the question a carve is parked on',
    description:
      'Hand back output matching `request.schema`. A shape the schema rejects costs you a retry ' +
      'and nothing else — the carve stays where it is, with the errors, so fix and call again.',
    inputSchema: {
      type: 'object',
      properties: {
        carveId: str('From ankou_carve_start.'),
        output: { type: 'object', description: 'Your answer, shaped by `request.schema`.' },
      },
      required: ['carveId', 'output'],
    },
    run: async (input) => {
      const id = String(input.carveId ?? '')
      const outcome = job.answer(id, input.output)
      if ('problems' in outcome) {
        return {
          carveId: id,
          state: 'rejected',
          problems: outcome.problems,
          next: 'Fix the output against `request.schema` and call ankou_carve_answer again.',
        }
      }
      return report(id, await outcome)
    },
  },
  {
    name: 'ankou_carve_cancel',
    title: 'Abandon a carve',
    description: 'Stop a run and forget it. Open carves are also listed here.',
    inputSchema: {
      type: 'object',
      properties: { carveId: str('Omit to just list what is open.') },
    },
    run: (input) => {
      if (typeof input.carveId === 'string' && input.carveId) {
        job.cancel(input.carveId)
        return { cancelled: input.carveId, open: job.open() }
      }
      return { open: job.open() }
    },
  },
  {
    name: 'ankou_validate',
    title: 'Check a piece before rendering it',
    description:
      'What is missing or wrong in a piece, using the same check the renderers rely on. Empty ' +
      'means renderable.',
    inputSchema: {
      type: 'object',
      properties: { piece: { type: 'object', description: 'The piece to check.' } },
      required: ['piece'],
    },
    run: (input) => ({ problems: pieceProblems(input.piece) }),
  },
  {
    name: 'ankou_render',
    title: 'Render a piece onto a surface',
    description:
      'A pure function of the piece: no model, no network. Writes a self-contained HTML page ' +
      '(or a transcript, or JSON) and returns the path — never the bytes, because a rendered ' +
      'page belongs in a browser, not in your context.',
    inputSchema: {
      type: 'object',
      properties: {
        piece: {
          description: 'A piece, or the carveId of a finished carve.',
          type: ['object', 'string'],
        },
        renderer: { type: 'string', enum: RENDERERS, description: 'Default html.' },
        theme: { type: 'string', enum: ['auto', 'light', 'dark'] },
        out: str('Where to write it. Default: a temporary file.'),
      },
      required: ['piece'],
    },
    run: async (input) => {
      const piece = pieceFrom(input.piece)
      const asked = typeof input.renderer === 'string' ? input.renderer : 'html'
      const renderer: RendererId = isRendererId(asked) ? asked : 'html'
      const output = render(piece, renderer, {
        ...(input.theme === 'dark' || input.theme === 'light' ? { theme: input.theme } : {}),
      })
      const path = await writeOut(output.content, output.ext, input.out)
      return { path, renderer, bytes: Buffer.byteLength(output.content), format: piece.format }
    },
  },
]

const BY_NAME = new Map(TOOLS.map((tool) => [tool.name, tool]))

/** MCP wants tool results as content blocks; ours are all JSON. */
function asContent(value: unknown): unknown {
  return {
    content: [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    structuredContent:
      value && typeof value === 'object' && !Array.isArray(value) ? value : { value },
  }
}

export async function runMcpServer(
  input: NodeJS.ReadableStream = process.stdin,
  output: NodeJS.WritableStream = process.stdout,
): Promise<void> {
  await serve(input, output, async (params, method) => {
    switch (method) {
      case 'initialize':
        return {
          // Echo a protocol the client named when we can speak it at all; MCP
          // revisions have so far only added to this surface.
          protocolVersion:
            typeof params.protocolVersion === 'string' ? params.protocolVersion : PROTOCOL,
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: 'ankou', version: VERSION },
          instructions:
            'ankou reshapes documents into the form someone wants to read them in. You are the ' +
            'model: ankou_carve_start parks on a schema-shaped question, you answer it with ' +
            'ankou_carve_answer, and ankou assembles and renders the result. Call ankou_gaps ' +
            'first and resolve what the document assumes — that is what you can do that a ' +
            'one-shot pipeline cannot.',
        }
      case 'notifications/initialized':
      case 'notifications/cancelled':
        return {}
      case 'ping':
        return {}
      case 'tools/list':
        return {
          tools: TOOLS.map(({ name, title, description, inputSchema }) => ({
            name,
            title,
            description,
            inputSchema,
          })),
        }
      case 'tools/call': {
        const name = String(params.name ?? '')
        const tool = BY_NAME.get(name)
        if (!tool) throw new MethodError(RPC.invalidParams, `No tool called \`${name}\`.`)
        const args = (params.arguments ?? {}) as Record<string, unknown>
        try {
          return asContent(await tool.run(args))
        } catch (error) {
          if (error instanceof MethodError) throw error
          // A tool that failed on its own terms is a result, not a protocol
          // error: the caller can read why and try something else.
          return {
            isError: true,
            content: [
              { type: 'text', text: error instanceof Error ? error.message : String(error) },
            ],
          }
        }
      }
      default:
        throw new MethodError(RPC.methodNotFound, `Unsupported method \`${method}\`.`)
    }
  })
}

export type { RpcRequest }
