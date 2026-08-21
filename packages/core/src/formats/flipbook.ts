import { ask } from '../llm/index.js'
import { S } from '../schema/validate.js'
import type { Document, FlipbookChapter, FlipbookPiece } from '../types.js'
import { charCount } from '../util/text.js'
import {
  baseMeta,
  type ComposeContext,
  clamp,
  type FormatModule,
  joinedText,
  param,
  systemPrompt,
  titleOf,
} from './base.js'

/**
 * Flipbook is the "read every single character" format.
 *
 * The important design decision lives here: the model is never allowed to write
 * the body. It only annotates — chapter titles, terms worth emphasising,
 * readings for hard words, pacing. The text itself is sliced verbatim out of the
 * source, so "一字一句" is a structural guarantee rather than a promise the
 * model has to keep.
 */

const TARGET_CHAPTER_CHARS = 2400

function chaptersFromDocuments(documents: Document[]): FlipbookChapter[] {
  const chapters: FlipbookChapter[] = []

  for (const document of documents) {
    const usable = document.sections.filter((section) => section.text.trim() || section.title)
    if (usable.length >= 2) {
      // Merge runs of tiny sections so a chapter is a reading unit, not a stub.
      let buffer: FlipbookChapter | null = null
      for (const section of usable) {
        const body = section.title ? `${section.title}\n\n${section.text}` : section.text
        if (buffer && charCount(buffer.text) < TARGET_CHAPTER_CHARS / 2) {
          buffer.text = `${buffer.text}\n\n${body}`.trim()
        } else {
          if (buffer) chapters.push(buffer)
          buffer = { title: section.title || '', text: body.trim() }
        }
      }
      if (buffer) chapters.push(buffer)
    } else {
      // No headings to lean on: cut on paragraph boundaries near the target.
      let buffer = ''
      for (const paragraph of document.text.split(/\n{2,}/)) {
        buffer = buffer ? `${buffer}\n\n${paragraph}` : paragraph
        if (charCount(buffer) >= TARGET_CHAPTER_CHARS) {
          chapters.push({ title: '', text: buffer.trim() })
          buffer = ''
        }
      }
      if (buffer.trim()) chapters.push({ title: '', text: buffer.trim() })
    }
  }

  return chapters.filter((chapter) => chapter.text.trim().length > 0)
}

const ANNOTATION_SCHEMA = S.object(
  {
    title: S.string('A short title for the whole reading session.'),
    chapterTitles: S.array(
      S.string(),
      'One title per chapter, in order, same length as the chapter list. Keep an existing title unless it is empty.',
    ),
    emphasis: S.array(
      S.object(
        {
          term: S.string('The exact term as it appears in the text.'),
          gloss: S.string('A six-word-or-shorter note shown beside it. Optional.'),
          weight: S.integer('1 = notable, 2 = important, 3 = the crux.', {
            minimum: 1,
            maximum: 3,
          }),
        },
        ['term', 'weight'],
      ),
      'Terms the reader should feel land as they scroll past.',
      { maxItems: 40 },
    ),
    ruby: S.array(
      S.object(
        {
          term: S.string('The exact substring needing a reading.'),
          reading: S.string('Its reading, in kana for Japanese.'),
        },
        ['term', 'reading'],
      ),
      'Readings for words a reader may stumble on. Empty for languages that do not need it.',
      { maxItems: 40 },
    ),
    pacing: S.object(
      {
        baseMs: S.number('Milliseconds per character. 40-90 is comfortable.', {
          minimum: 8,
          maximum: 400,
        }),
        note: S.string('One line on why this pace suits this text.'),
      },
      ['baseMs'],
    ),
  },
  ['title', 'chapterTitles', 'emphasis', 'ruby', 'pacing'],
)

interface Annotations {
  title: string
  chapterTitles: string[]
  emphasis: { term: string; gloss?: string; weight: number }[]
  ruby: { term: string; reading: string }[]
  pacing: { baseMs: number; note?: string }
}

async function annotate(
  context: ComposeContext,
  chapters: FlipbookChapter[],
): Promise<Annotations> {
  // Annotation only needs a representative sample, not the whole text.
  const sample = joinedText(context).slice(0, context.windowChars)
  const outline = chapters
    .map(
      (chapter, index) =>
        `${index + 1}. ${chapter.title || '(untitled)'} — ${charCount(chapter.text)} chars`,
    )
    .join('\n')

  return ask<Annotations>(context.llm, {
    name: 'flipbook_annotations',
    schema: ANNOTATION_SCHEMA,
    system: systemPrompt(
      context,
      'You are annotating a text that will be played back one character at a time, like a flipbook. You never rewrite the text; you only mark it up.',
    ),
    prompt: `The reader's intent: ${context.intent}

The text is split into ${chapters.length} chapters:
${outline}

Return exactly ${chapters.length} chapter titles, in order. Where a chapter already has a title, keep it.

Choose the pace from how dense the writing is: dense technical prose deserves a slower baseMs than a breezy essay.

Here is the beginning of the text:
---
${sample}
---`,
    temperature: 0.3,
    signal: context.signal,
  })
}

export const flipbook: FormatModule<'flipbook'> = {
  id: 'flipbook',
  label: 'Flipbook',
  description:
    'Plays the source back one character at a time, verbatim, with emphasis and readings. Nothing is summarised or dropped.',
  bestFor: [
    'reading every single word without skimming',
    'short but dense text worth savouring',
    'poetry, contracts, specs, anything where wording matters',
    'staying focused on a text you keep bouncing off',
  ],
  params: {
    baseMs: 'Milliseconds per character; lower is faster.',
  },

  async compose(context): Promise<FlipbookPiece> {
    const chapters = chaptersFromDocuments(context.documents)
    const annotations = await annotate(context, chapters)

    const titled = chapters.map((chapter, index) => ({
      ...chapter,
      title: chapter.title || annotations.chapterTitles[index]?.trim() || `Part ${index + 1}`,
    }))

    const baseMs = clamp(param(context.plan, 'baseMs', annotations.pacing?.baseMs ?? 55), 8, 400)

    return {
      format: 'flipbook',
      title: annotations.title?.trim() || titleOf(context),
      lang: context.lang,
      meta: baseMeta(context),
      chapters: titled,
      emphasis: (annotations.emphasis ?? [])
        .filter((item) => item.term?.trim())
        .map((item) => ({
          term: item.term,
          ...(item.gloss ? { gloss: item.gloss } : {}),
          weight: clamp(Math.round(item.weight ?? 1), 1, 3) as 1 | 2 | 3,
        })),
      ruby: (annotations.ruby ?? []).filter((item) => item.term?.trim() && item.reading?.trim()),
      pacing: {
        baseMs,
        punctuationMs: Math.round(baseMs * 6),
        paragraphMs: Math.round(baseMs * 12),
      },
    }
  },
}
