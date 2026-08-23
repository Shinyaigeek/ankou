import { composeError } from '../errors.js'
import type { LLM } from '../llm/types.js'
import type { Document, FormatId, OnProgress, Piece, PieceBase, Plan } from '../types.js'
import { charCount, windows } from '../util/text.js'

export interface ComposeContext {
  documents: Document[]
  /** What the reader said they want out of this. */
  intent: string
  plan: Plan
  llm: LLM
  /** Language the output should be written in. */
  lang: string
  /** Characters of source text sent to the model in one call. */
  windowChars: number
  onProgress?: OnProgress
  signal?: AbortSignal
}

/**
 * A knob the planner may set, and the CLI may override with `--param`.
 *
 * The type is here rather than in the planner's schema because the registry has
 * to be the only place a format is described: a schema kept in step by hand
 * drifts the moment someone adds a format, and a knob missing from it cannot be
 * set at all — a provider's grammar drops an undeclared property in silence.
 */
export interface FormatParam {
  type: 'integer' | 'string'
  description: string
}

export interface FormatModule<F extends FormatId = FormatId> {
  id: F
  label: string
  /** One line for `ankou formats` and for the planner's menu. */
  description: string
  /** Concrete reader intents this format is the right answer to. */
  bestFor: string[]
  /** Knobs the planner may set in `plan.params`, documented for the prompt. */
  params: Record<string, FormatParam>
  compose(context: ComposeContext): Promise<Extract<Piece, { format: F }>>
}

export const LANG_NAMES: Record<string, string> = {
  ja: 'Japanese',
  en: 'English',
  zh: 'Chinese',
  ko: 'Korean',
  ru: 'Russian',
}

/**
 * Name a language the way the prompt has to say it.
 *
 * "Write all reader-facing text in fr." is a worse instruction than "in French",
 * and the five-entry table left every other language as its tag. `Intl` knows
 * all of them and ships with Node, so the table is now only a fast path and a
 * guarantee for the languages ankou cares most about.
 */
export function languageName(lang: string): string {
  const tag = lang.trim()
  if (!tag) return 'the language of the source'
  try {
    const named = new Intl.DisplayNames(['en'], { type: 'language' }).of(tag)
    // A tag `Intl` does not recognise comes back unchanged, which is no better
    // than not asking; the table below still gets its turn.
    if (named && named !== tag) return named
  } catch {
    // A Node built without the full locale data. The table is the guarantee.
  }
  return LANG_NAMES[tag] ?? LANG_NAMES[tag.slice(0, 2).toLowerCase()] ?? tag
}

/** The system prompt every format shares. */
export function systemPrompt(context: ComposeContext, role: string): string {
  return `You are ankou, a tool that reshapes documents into the form a reader actually wants.

${role}

Rules that always apply:
- Write all reader-facing text in ${languageName(context.lang)}.
- Stay faithful to the source. Never invent facts, numbers, names or claims that are not in it.
- If the source is thin on something the reader asked for, say less rather than padding.
- Match the source's register: a casual blog post should not come out as a corporate deck.
- The reader's stated intent is the brief. Honour it over your own idea of what is interesting.`
}

export function joinedText(context: ComposeContext): string {
  return context.documents
    .map((document) =>
      context.documents.length > 1 ? `# ${document.title}\n\n${document.text}` : document.text,
    )
    .join('\n\n---\n\n')
}

export function titleOf(context: ComposeContext): string {
  if (context.documents.length === 1) return context.documents[0]!.title
  const first = context.documents[0]?.title ?? 'Untitled'
  return `${first} +${context.documents.length - 1}`
}

export function baseMeta(context: ComposeContext): PieceBase['meta'] {
  return {
    sources: context.documents.map((document) => ({
      title: document.title,
      ref: document.origin.ref,
      kind: document.origin.kind,
    })),
    intent: context.intent,
    rationale: context.plan.rationale,
    generatedBy: context.llm.name,
    charCount: context.documents.reduce((sum, document) => sum + document.charCount, 0),
  }
}

/** Split the source across calls and run `fn` on each window, in order. */
export async function mapWindows<T>(
  context: ComposeContext,
  fn: (chunk: string, index: number, total: number) => Promise<T>,
): Promise<T[]> {
  const chunks = windows(joinedText(context), context.windowChars, 200)
  const results: T[] = []
  for (const [index, chunk] of chunks.entries()) {
    context.signal?.throwIfAborted()
    context.onProgress?.({
      stage: 'compose',
      message:
        chunks.length > 1 ? `Reading part ${index + 1} of ${chunks.length}` : 'Reading the source',
      progress: index / chunks.length,
    })
    results.push(await fn(chunk, index, chunks.length))
  }
  return results
}

/**
 * Read a knob from the plan, or fall back.
 *
 * A knob that cannot be used is not a knob. `--param slideCount=twelve` reached
 * the prompt as "Write about NaN slides", because the value was handed on
 * unexamined and every arithmetic on it after that was NaN. Where the fallback
 * says a number is wanted, a value that is not one is not one.
 */
export function param<T>(plan: Plan, key: string, fallback: T): T {
  const value = plan.params[key]
  if (value === undefined || value === null) return fallback
  if (typeof fallback === 'number') {
    // Only a number or a string that spells one. `Number` reads '' as 0 and
    // `true` as 1, and neither of those is a count anybody asked for.
    const spelled = typeof value === 'string' && value.trim() !== '' ? Number(value.trim()) : value
    return (typeof spelled === 'number' && Number.isFinite(spelled) ? spelled : fallback) as T
  }
  return value as T
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

/** A sensible number of output units for a document of this size. */
export function scaleToLength(text: string, unitsPer1000Chars: number, min: number, max: number) {
  return clamp(Math.round((charCount(text) / 1000) * unitsPer1000Chars), min, max)
}

/**
 * Refuse to hand back a piece with nothing in it.
 *
 * Every renderer will lay out an empty page quite happily — a deck with no
 * slides, a quiz that reads "0 questions · pass mark 1" — so a model that
 * returned nothing usable reaches the reader as a finished-looking file. Failing
 * here costs them a rerun; not failing costs them the ability to trust that a
 * file ankou wrote means anything.
 */
export function requireContent(count: number, what: string): void {
  if (count > 0) return
  throw composeError(
    `The model returned no usable ${what}.`,
    'A small local model often needs a second attempt; a larger one usually does not. `--render json` shows what came back.',
  )
}
