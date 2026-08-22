import { FORMAT_IDS, FORMATS } from './formats/index.js'
import { ask } from './llm/index.js'
import type { JsonSchema, LLM } from './llm/types.js'
import { S } from './schema/validate.js'
import type { Document, FormatId, Plan } from './types.js'
import { charCount } from './util/text.js'

/**
 * Every knob any format declares, as one object the planner may fill.
 *
 * Derived from the registry rather than written out, because a hand-kept copy
 * fails silently: the menu the model reads is built from `format.params`, so a
 * new knob appears in the prompt, but a provider's grammar drops any property
 * the schema does not declare. The planner would ask for it and never get it.
 *
 * The namespace is flat and shared — `param()` reads `plan.params` by name — so
 * two formats naming the same knob must mean the same thing by it.
 */
function paramsSchema(): JsonSchema {
  const properties: Record<string, JsonSchema> = {}
  for (const id of FORMAT_IDS) {
    for (const [key, knob] of Object.entries(FORMATS[id].params)) {
      properties[key] =
        knob.type === 'integer' ? S.integer(knob.description) : S.string(knob.description)
    }
  }
  return S.object(properties, [], 'Only the knobs that belong to the chosen format. Omit the rest.')
}

const PLAN_SCHEMA = S.object(
  {
    format: S.enum(FORMAT_IDS, 'The output format that best serves the reader.'),
    rationale: S.string('One or two sentences, addressed to the reader, on why this shape fits.'),
    params: paramsSchema(),
  },
  ['format', 'rationale'],
)

function menu(): string {
  return FORMAT_IDS.map((id) => {
    const format = FORMATS[id]
    const params = Object.entries(format.params)
      .map(([key, knob]) => `      ${key} (${knob.type}): ${knob.description}`)
      .join('\n')
    return `- ${id}: ${format.description}
    Best for:
${format.bestFor.map((use) => `      - ${use}`).join('\n')}
    Params:
${params || '      (none)'}`
  }).join('\n\n')
}

function profile(documents: Document[]): string {
  return documents
    .map((document) => {
      const headings = document.sections
        .filter((section) => section.title)
        .slice(0, 25)
        .map((section) => `${'  '.repeat(Math.max(0, section.level - 1))}- ${section.title}`)
        .join('\n')
      return `Title: ${document.title}
Source: ${document.origin.kind} (${document.origin.ref})
Length: ${document.charCount} characters
Language: ${document.lang}
Opening:
"""
${document.text.slice(0, 700)}
"""
${headings ? `Outline:\n${headings}` : 'No headings.'}`
    })
    .join('\n\n')
}

export interface PlanOptions {
  /** Skip the model and use this format. */
  format?: FormatId
  /** Merged over whatever the planner chooses. */
  params?: Record<string, unknown>
  signal?: AbortSignal
}

/**
 * Decide what shape the reader wants.
 *
 * When the caller names a format, this costs nothing: an explicit `--format`
 * always beats the model's opinion, and the planner call is skipped entirely.
 */
export async function plan(
  documents: Document[],
  intent: string,
  llm: LLM,
  options: PlanOptions = {},
): Promise<Plan> {
  if (options.format) {
    return {
      format: options.format,
      rationale: `Requested explicitly: ${FORMATS[options.format].description}`,
      params: { ...options.params },
    }
  }

  const totalChars = documents.reduce((sum, document) => sum + document.charCount, 0)

  const chosen = await ask<{
    format: FormatId
    rationale: string
    params?: Record<string, unknown>
  }>(llm, {
    name: 'reading_plan',
    schema: PLAN_SCHEMA,
    system: `You are kamu's planner. A reader hands you a document and says what they want out of it; you choose the shape it should be delivered in.

Choose by what the reader will *do* with it, not by what the document is. "I want to take this in properly" is a flipbook; "I need to remember this" is a quiz; "what does this even say" is a summary.

Do not pick a format just because it is impressive. Picking the boring right one is the job.

Write the rationale in the same language as the reader's intent.`,
    prompt: `The reader's intent: "${intent}"

Available formats:

${menu()}

The material (${documents.length} document${documents.length === 1 ? '' : 's'}, ${totalChars} characters total):

${profile(documents)}`,
    temperature: 0.2,
    maxTokens: 2048,
    signal: options.signal,
  })

  return {
    format: chosen.format,
    rationale: chosen.rationale ?? '',
    params: { ...(chosen.params ?? {}), ...options.params },
  }
}

/**
 * A keyword fallback for callers that want a format without spending a call.
 * Deliberately crude — the model does this far better.
 */
export function guessFormat(intent: string): FormatId {
  const text = intent.toLowerCase()
  const rules: [RegExp, FormatId][] = [
    [
      /一字一句|一言一句|verbatim|every (single )?word|character by character|精読|音読/,
      'flipbook',
    ],
    [/quiz|test me|覚え|暗記|復習|問題|recall|exam|試験/, 'quiz'],
    [/slide|deck|present|プレゼン|スライド|発表/, 'slides'],
    [/anima|movie|cinemat|動画|アニメ|映像|かっこよく/, 'animation'],
    [/dialog|conversation|explain to me|対話|会話|解説して/, 'dialogue'],
  ]
  for (const [pattern, format] of rules) if (pattern.test(text)) return format
  return 'summary'
}

export function documentTotalChars(documents: Document[]): number {
  return documents.reduce((sum, document) => sum + charCount(document.text), 0)
}
