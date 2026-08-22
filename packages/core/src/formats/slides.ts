import { ask } from '../llm/index.js'
import { S } from '../schema/validate.js'
import type { Slide, SlidesPiece } from '../types.js'
import {
  baseMeta,
  clamp,
  type FormatModule,
  joinedText,
  mapWindows,
  param,
  requireContent,
  scaleToLength,
  systemPrompt,
  titleOf,
} from './base.js'

const SLIDE_SCHEMA = S.object(
  {
    title: S.string('Deck title. Only used for the first window.'),
    slides: S.array(
      S.object(
        {
          title: S.string(
            'Slide headline. A claim, not a label — "X halves latency", not "About X".',
          ),
          bullets: S.array(S.string('One idea, at most ~14 words.'), 'Two to five bullets.', {
            maxItems: 6,
          }),
          notes: S.string('What a presenter would say out loud. Optional.'),
          visual: S.object(
            {
              type: S.enum(['quote', 'stat', 'mermaid', 'code'], 'Focal element type.'),
              text: S.string('For type=quote: the quoted line, verbatim from the source.'),
              attribution: S.string('For type=quote: who said it.'),
              value: S.string('For type=stat: the number, e.g. "3.4x".'),
              caption: S.string('For type=stat: what the number measures.'),
              code: S.string('For type=mermaid or code: the code or mermaid source.'),
              language: S.string('For type=code: the language.'),
            },
            ['type'],
            'Optional focal element. Use sparingly — at most one slide in three.',
          ),
        },
        ['title', 'bullets'],
      ),
    ),
  },
  ['slides'],
)

interface SlideDraft {
  title?: string
  slides: {
    title: string
    bullets: string[]
    notes?: string
    visual?: Record<string, string>
  }[]
}

function toVisual(raw: Record<string, string> | undefined): Slide['visual'] {
  if (!raw?.type) return undefined
  switch (raw.type) {
    case 'quote':
      return raw.text
        ? {
            type: 'quote',
            text: raw.text,
            ...(raw.attribution ? { attribution: raw.attribution } : {}),
          }
        : undefined
    case 'stat':
      return raw.value ? { type: 'stat', value: raw.value, caption: raw.caption ?? '' } : undefined
    case 'mermaid':
      return raw.code ? { type: 'mermaid', code: raw.code } : undefined
    case 'code':
      return raw.code
        ? { type: 'code', language: raw.language ?? 'text', code: raw.code }
        : undefined
    default:
      return undefined
  }
}

export const slides: FormatModule<'slides'> = {
  id: 'slides',
  label: 'Slides',
  description:
    'A deck: one claim per slide with supporting bullets and speaker notes. Good for grasping the shape of an argument fast.',
  bestFor: [
    'getting the gist quickly',
    'presenting or explaining the material to someone else',
    'structured overview of a long document',
    'reviewing something you have read before',
  ],
  params: {
    slideCount: { type: 'integer', description: 'Roughly how many slides to produce.' },
    tone: { type: 'string', description: 'e.g. "casual", "academic", "executive".' },
  },

  async compose(context): Promise<SlidesPiece> {
    const total = clamp(
      param(context.plan, 'slideCount', scaleToLength(joinedText(context), 1.6, 5, 40)),
      3,
      80,
    )
    const tone = param(context.plan, 'tone', '')

    const drafts = await mapWindows(context, async (chunk, index, count) => {
      const share = Math.max(2, Math.round(total / count))
      return ask<SlideDraft>(context.llm, {
        name: 'slide_deck',
        schema: SLIDE_SCHEMA,
        system: systemPrompt(
          context,
          'You turn documents into decks. Every slide headline is a claim the source actually makes. A slide the reader would skip is a slide you should not have written.',
        ),
        prompt: `The reader's intent: ${context.intent}
${tone ? `Requested tone: ${tone}\n` : ''}
${count > 1 ? `This is part ${index + 1} of ${count} of a longer document. Cover only this part; later parts are handled separately.\n` : ''}
Produce about ${share} slides${index === 0 ? ', plus a deck title' : ''}.

Source:
---
${chunk}
---`,
        temperature: 0.4,
        signal: context.signal,
      })
    })

    const merged: Slide[] = drafts.flatMap((draft) =>
      (draft.slides ?? [])
        .filter((slide) => slide.title?.trim())
        .map((slide) => ({
          title: slide.title.trim(),
          bullets: (slide.bullets ?? []).map((bullet) => bullet.trim()).filter(Boolean),
          ...(slide.notes ? { notes: slide.notes } : {}),
          ...(toVisual(slide.visual) ? { visual: toVisual(slide.visual) } : {}),
        })),
    )

    requireContent(merged.length, 'slides')

    return {
      format: 'slides',
      title: drafts[0]?.title?.trim() || titleOf(context),
      lang: context.lang,
      meta: baseMeta(context),
      slides: merged,
    }
  },
}
