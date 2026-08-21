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

export interface FormatModule<F extends FormatId = FormatId> {
  id: F
  label: string
  /** One line for `kamu formats` and for the planner's menu. */
  description: string
  /** Concrete reader intents this format is the right answer to. */
  bestFor: string[]
  /** Knobs the planner may set in `plan.params`, documented for the prompt. */
  params: Record<string, string>
  compose(context: ComposeContext): Promise<Extract<Piece, { format: F }>>
}

export const LANG_NAMES: Record<string, string> = {
  ja: 'Japanese',
  en: 'English',
  zh: 'Chinese',
  ko: 'Korean',
  ru: 'Russian',
}

export function languageName(lang: string): string {
  return LANG_NAMES[lang] ?? lang
}

/** The system prompt every format shares. */
export function systemPrompt(context: ComposeContext, role: string): string {
  return `You are kamu, a tool that reshapes documents into the form a reader actually wants.

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

export function param<T>(plan: Plan, key: string, fallback: T): T {
  const value = plan.params[key]
  return value === undefined || value === null ? fallback : (value as T)
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

/** A sensible number of output units for a document of this size. */
export function scaleToLength(text: string, unitsPer1000Chars: number, min: number, max: number) {
  return clamp(Math.round((charCount(text) / 1000) * unitsPer1000Chars), min, max)
}
