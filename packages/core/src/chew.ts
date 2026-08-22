import { configError, ingestError } from './errors.js'
import { type ComposeContext, getFormat } from './formats/index.js'
import { type IngestOptions, ingestAll } from './ingest/index.js'
import { createLLM, detectProvider } from './llm/index.js'
import type { LLM, ProviderId, ProviderOptions } from './llm/types.js'
import { plan as makePlan } from './plan.js'
import { render } from './render/index.js'
import type {
  Document,
  FormatId,
  OnProgress,
  Piece,
  Plan,
  RendererId,
  RenderOptions,
  RenderResult,
  Source,
} from './types.js'
import { detectLang } from './util/text.js'

export interface ChewOptions {
  /** What the reader wants out of this. The whole point of the tool. */
  intent: string
  /** Sources: paths, URLs, or inline content. */
  sources: Source[]
  /** Skip the planner and use this format. */
  format?: FormatId
  /** Merged into whatever params the planner chooses. */
  params?: Record<string, unknown>
  /** Bring your own model, or let kamu build one from `provider`. */
  llm?: LLM
  provider?: ProviderId
  providerOptions?: ProviderOptions
  /** Force the output language; defaults to the source's. */
  lang?: string
  /** Characters of source sent to the model per call. */
  windowChars?: number
  ingest?: IngestOptions
  onProgress?: OnProgress
  signal?: AbortSignal
}

export interface ChewResult {
  piece: Piece
  plan: Plan
  documents: Document[]
}

export interface ChewPlanResult {
  plan: Plan
  documents: Document[]
  /** The model the plan was made with, ready to compose with. */
  llm: LLM
  /** The language the result would be written in. */
  lang: string
}

/**
 * Which language the result should be written in.
 *
 * The reader wrote the intent, so the intent wins when it carries a clear
 * signal — asking in Japanese about an English page should give you Japanese.
 * `detectLang` returns 'en' both for English and for "nothing to go on", so an
 * English-looking intent defers to the source instead.
 */
function outputLanguage(intent: string, documents: Document[]): string {
  const fromIntent = detectLang(intent)
  if (fromIntent !== 'en') return fromIntent
  return documents[0]?.lang ?? 'en'
}

function resolveLLM(options: ChewOptions): LLM {
  if (options.llm) return options.llm
  const provider = options.provider ?? detectProvider()
  if (!provider) {
    throw configError(
      'No LLM provider configured.',
      'Set ANTHROPIC_API_KEY, or pass `provider` explicitly — "claude-code" uses a Claude Code subscription and "ollama" runs locally.',
    )
  }
  return createLLM(provider, options.providerOptions ?? {})
}

/**
 * Ingest → plan, and stop.
 *
 * Composition is where the tokens go, so deciding the shape is worth having on
 * its own: it is what `--plan-only` needs, and it lets a caller show the reader
 * what it is about to make before making it.
 */
export async function chewPlan(options: ChewOptions): Promise<ChewPlanResult> {
  const llm = resolveLLM(options)
  const progress = options.onProgress

  progress?.({ stage: 'ingest', message: 'Reading the sources' })
  const documents = await ingestAll(options.sources, options.ingest ?? {})
  if (documents.length === 0) throw configError('No sources to chew.')
  // A model handed nothing does not say "there was nothing there". It writes a
  // summary of the document it imagines you meant, and the run looks like it
  // worked. `requireContent` cannot catch that: the model did return content.
  if (documents.every((document) => document.charCount === 0)) {
    throw ingestError(
      documents.length === 1
        ? `There is no text in ${documents[0]!.origin.ref}.`
        : `There is no text in any of: ${documents.map((d) => d.origin.ref).join(', ')}.`,
      'A model asked to read an empty source will invent one. Check the path, or whether the file is a scan or a client-rendered page.',
    )
  }
  options.signal?.throwIfAborted()

  progress?.({ stage: 'plan', message: 'Working out what shape you want' })
  const plan = await makePlan(documents, options.intent, llm, {
    format: options.format,
    params: options.params,
    signal: options.signal,
  })
  options.signal?.throwIfAborted()

  return { plan, documents, llm, lang: options.lang ?? outputLanguage(options.intent, documents) }
}

/**
 * Ingest → plan → compose. The result is a `Piece`: the format-specific
 * intermediate representation, not yet rendered.
 *
 * Keeping composition and rendering apart is what lets the same chewed piece be
 * played in a terminal, opened in a browser, or handed to another program as
 * JSON without asking the model to do the work twice.
 */
export async function chew(options: ChewOptions): Promise<ChewResult> {
  const { plan, documents, llm, lang } = await chewPlan(options)

  const context: ComposeContext = {
    documents,
    intent: options.intent,
    plan,
    llm,
    lang,
    windowChars: options.windowChars ?? 24_000,
    onProgress: options.onProgress,
    signal: options.signal,
  }

  options.onProgress?.({ stage: 'compose', message: `Chewing into ${plan.format}` })
  const piece = await getFormat(plan.format).compose(context)

  return { piece, plan, documents }
}

export interface ChewAndRenderOptions extends ChewOptions {
  renderer?: RendererId
  renderOptions?: RenderOptions
}

/** `chew`, then render in one call — the shape most callers want. */
export async function chewAndRender(
  options: ChewAndRenderOptions,
): Promise<ChewResult & { output: RenderResult }> {
  const result = await chew(options)
  options.onProgress?.({ stage: 'render', message: `Rendering as ${options.renderer ?? 'html'}` })
  return {
    ...result,
    output: render(result.piece, options.renderer ?? 'html', options.renderOptions ?? {}),
  }
}
