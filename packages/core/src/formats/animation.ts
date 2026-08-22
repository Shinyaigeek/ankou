import { ask } from '../llm/index.js'
import { S } from '../schema/validate.js'
import type { AnimationPiece, Scene } from '../types.js'
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

const SCENE_SCHEMA = S.object(
  {
    title: S.string('Title card text.'),
    scenes: S.array(
      S.object(
        {
          lines: S.array(
            S.object(
              {
                text: S.string(
                  'One line on screen. Short — this is kinetic typography, not a paragraph.',
                ),
                scale: S.enum(['sm', 'md', 'lg', 'xl'], 'Relative size of this line.'),
                accent: S.string('"true" to colour this line as the emphasis of the scene.'),
              },
              ['text'],
            ),
            'One to four lines per scene.',
            { maxItems: 4 },
          ),
          motion: S.enum(
            ['fade', 'slide-up', 'zoom', 'typewriter', 'stagger', 'flip'],
            'How the lines arrive. Match the motion to the meaning: zoom for a reveal, typewriter for a quote.',
          ),
          durationMs: S.integer('How long the entrance takes.', { minimum: 200, maximum: 4000 }),
          holdMs: S.integer('How long it rests before moving on.', { minimum: 300, maximum: 8000 }),
          mood: S.enum(['calm', 'tense', 'bright', 'dark'], 'Palette for the scene.'),
        },
        ['lines', 'motion', 'durationMs', 'holdMs', 'mood'],
      ),
    ),
  },
  ['scenes'],
)

interface AnimationDraft {
  title?: string
  scenes: {
    lines: { text: string; scale?: string; accent?: string | boolean }[]
    motion: Scene['motion']
    durationMs: number
    holdMs: number
    mood: Scene['mood']
  }[]
}

export const animation: FormatModule<'animation'> = {
  id: 'animation',
  label: 'Animation',
  description:
    'Kinetic typography: the ideas arrive as timed, moving text. Cinematic rather than exhaustive.',
  bestFor: [
    'making an idea land emotionally',
    'a manifesto, a story, a pitch',
    'material you want to feel rather than study',
    'sharing something so other people actually watch it',
  ],
  params: {
    sceneCount: { type: 'integer', description: 'How many scenes.' },
    pace: { type: 'string', description: '"slow", "medium" or "fast".' },
  },

  async compose(context): Promise<AnimationPiece> {
    const total = clamp(
      param(context.plan, 'sceneCount', scaleToLength(joinedText(context), 1.0, 6, 30)),
      4,
      60,
    )
    const pace = param(context.plan, 'pace', 'medium')

    const drafts = await mapWindows(context, async (chunk, index, count) => {
      const share = Math.max(3, Math.round(total / count))
      return ask<AnimationDraft>(context.llm, {
        name: 'animation',
        schema: SCENE_SCHEMA,
        system: systemPrompt(
          context,
          'You storyboard kinetic typography. You are cutting a trailer, not writing a report: pick the lines that hit, give them room, and let the motion carry the meaning. Quote the source directly when its own words are the strongest thing you have.',
        ),
        prompt: `The reader's intent: ${context.intent}
Pace: ${pace}
${count > 1 ? `This is part ${index + 1} of ${count} of a longer document.\n` : ''}
Storyboard about ${share} scenes${index === 0 ? ', plus a title' : ''}. Build an arc — do not just list facts in order.

Source:
---
${chunk}
---`,
        temperature: 0.7,
        signal: context.signal,
      })
    })

    const scenes: Scene[] = drafts
      .flatMap((draft) => draft.scenes ?? [])
      .filter((scene) => scene.lines?.some((line) => line.text?.trim()))
      .map((scene, index) => ({
        id: `s${index + 1}`,
        lines: scene.lines
          .filter((line) => line.text?.trim())
          .map((line) => ({
            text: line.text.trim(),
            scale: (['sm', 'md', 'lg', 'xl'].includes(String(line.scale))
              ? line.scale
              : 'md') as Scene['lines'][number]['scale'],
            accent: line.accent === true || line.accent === 'true',
          })),
        motion: scene.motion ?? 'fade',
        durationMs: clamp(Math.round(scene.durationMs ?? 700), 200, 4000),
        holdMs: clamp(Math.round(scene.holdMs ?? 1600), 300, 8000),
        mood: scene.mood ?? 'calm',
      }))

    requireContent(scenes.length, 'scenes')

    return {
      format: 'animation',
      title: drafts[0]?.title?.trim() || titleOf(context),
      lang: context.lang,
      meta: baseMeta(context),
      scenes,
    }
  },
}
