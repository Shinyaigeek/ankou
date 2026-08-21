import { ask } from '../llm/index.js'
import { S } from '../schema/validate.js'
import type { SummaryPiece } from '../types.js'
import {
  baseMeta,
  type ComposeContext,
  type FormatModule,
  mapWindows,
  param,
  systemPrompt,
  titleOf,
} from './base.js'

const PARTIAL_SCHEMA = S.object(
  {
    summary: S.string('What this part of the document says, in a short paragraph.'),
    points: S.array(S.string('One concrete point.'), 'The load-bearing points of this part.', {
      maxItems: 12,
    }),
    terms: S.array(
      S.object({ term: S.string(), definition: S.string('One sentence.') }, ['term', 'definition']),
      'Terms the source relies on that a newcomer would not know.',
      { maxItems: 10 },
    ),
    sectionTitle: S.string('A title for this part.'),
  },
  ['summary', 'points', 'sectionTitle'],
)

const FINAL_SCHEMA = S.object(
  {
    title: S.string(),
    tldr: S.string('Two or three sentences. If the reader reads nothing else, this.'),
    keyPoints: S.array(
      S.object(
        { text: S.string('The point.'), detail: S.string('Optional supporting sentence.') },
        ['text'],
      ),
      'The points that survive ruthless cutting.',
      { maxItems: 12 },
    ),
    openQuestions: S.array(
      S.string(),
      'Things the source raises but does not answer. Empty if there are none — do not invent them.',
      { maxItems: 6 },
    ),
  },
  ['title', 'tldr', 'keyPoints', 'openQuestions'],
)

interface Partial_ {
  summary: string
  points: string[]
  terms?: { term: string; definition: string }[]
  sectionTitle: string
}

interface Final {
  title: string
  tldr: string
  keyPoints: { text: string; detail?: string }[]
  openQuestions: string[]
}

async function reduce(context: ComposeContext, partials: Partial_[]): Promise<Final> {
  const digest = partials
    .map(
      (partial, index) =>
        `## Part ${index + 1}: ${partial.sectionTitle}\n${partial.summary}\n${(partial.points ?? [])
          .map((point) => `- ${point}`)
          .join('\n')}`,
    )
    .join('\n\n')

  return ask<Final>(context.llm, {
    name: 'summary',
    schema: FINAL_SCHEMA,
    system: systemPrompt(
      context,
      'You compress documents without losing what matters. A summary that could describe any document on the topic is a failed summary: keep the specifics — the numbers, the names, the actual position taken.',
    ),
    prompt: `The reader's intent: ${context.intent}

Here is a part-by-part digest of the document:

${digest}

Write the top level: a TL;DR and the key points across the whole thing.`,
    temperature: 0.3,
    signal: context.signal,
  })
}

export const summary: FormatModule<'summary'> = {
  id: 'summary',
  label: 'Summary',
  description:
    'A layered digest: TL;DR, key points, a per-section outline, a glossary and the questions left open.',
  bestFor: [
    'deciding whether the full document is worth your time',
    'extracting the argument from a long or rambling source',
    'a reference you will come back to',
    'catching up on something quickly',
  ],
  params: {
    depth: '"brief" or "thorough".',
  },

  async compose(context): Promise<SummaryPiece> {
    const depth = param(context.plan, 'depth', 'thorough')

    const partials = await mapWindows(context, async (chunk, index, count) =>
      ask<Partial_>(context.llm, {
        name: 'summary_part',
        schema: PARTIAL_SCHEMA,
        system: systemPrompt(
          context,
          'You are digesting one part of a document. Keep the specifics; drop the throat-clearing.',
        ),
        prompt: `The reader's intent: ${context.intent}
Depth requested: ${depth}
${count > 1 ? `This is part ${index + 1} of ${count}.\n` : ''}
Source:
---
${chunk}
---`,
        temperature: 0.3,
        signal: context.signal,
      }),
    )

    context.onProgress?.({ stage: 'compose', message: 'Pulling it together', progress: 0.9 })
    const final = await reduce(context, partials)

    const glossary = new Map<string, string>()
    for (const partial of partials) {
      for (const term of partial.terms ?? []) {
        if (term.term?.trim() && !glossary.has(term.term)) glossary.set(term.term, term.definition)
      }
    }

    return {
      format: 'summary',
      title: final.title?.trim() || titleOf(context),
      lang: context.lang,
      meta: baseMeta(context),
      tldr: final.tldr ?? '',
      keyPoints: (final.keyPoints ?? []).filter((point) => point.text?.trim()),
      outline: partials.map((partial) => ({
        title: partial.sectionTitle ?? '',
        summary: partial.summary ?? '',
        points: partial.points ?? [],
      })),
      glossary: [...glossary].map(([term, definition]) => ({ term, definition })),
      openQuestions: final.openQuestions ?? [],
    }
  },
}
