import { ask } from '../llm/index.js'
import { S } from '../schema/validate.js'
import type { DialoguePiece } from '../types.js'
import {
  baseMeta,
  type FormatModule,
  mapWindows,
  param,
  requireContent,
  systemPrompt,
  titleOf,
} from './base.js'

const DIALOGUE_SCHEMA = S.object(
  {
    title: S.string(),
    speakers: S.array(
      S.object(
        {
          id: S.string('Short lowercase id.'),
          name: S.string(),
          role: S.string('One line on who they are.'),
        },
        ['id', 'name', 'role'],
      ),
      'Exactly two speakers: one who knows the material, one who is learning it.',
      { maxItems: 2 },
    ),
    turns: S.array(
      S.object({ speaker: S.string('A speaker id.'), text: S.string('What they say.') }, [
        'speaker',
        'text',
      ]),
    ),
  },
  ['speakers', 'turns'],
)

interface DialogueDraft {
  title?: string
  speakers: { id: string; name: string; role: string }[]
  turns: { speaker: string; text: string }[]
}

export const dialogue: FormatModule<'dialogue'> = {
  id: 'dialogue',
  label: 'Dialogue',
  description:
    'Two voices working through the material — one explaining, one asking the questions you would ask.',
  bestFor: [
    'material you find hard to get into',
    'understanding the why behind something, not just the what',
    'listening rather than reading',
    'surfacing the objections a straight explanation glosses over',
  ],
  params: {
    level: 'Assumed background: "beginner", "intermediate", "expert".',
  },

  async compose(context): Promise<DialoguePiece> {
    const level = param(context.plan, 'level', 'intermediate')

    const drafts = await mapWindows(context, async (chunk, index, count) =>
      ask<DialogueDraft>(context.llm, {
        name: 'dialogue',
        schema: DIALOGUE_SCHEMA,
        system: systemPrompt(
          context,
          'You write two-person dialogues that teach. The learner asks the awkward question the reader is actually thinking, and pushes back when an answer is hand-wavy. Neither voice is a doormat and neither monologues for long.',
        ),
        prompt: `The reader's intent: ${context.intent}
Assume the learner is at ${level} level.
${count > 1 ? `This is part ${index + 1} of ${count}. ${index > 0 ? 'Keep the same two speakers as before and continue naturally.' : ''}\n` : ''}
${index > 0 ? `Use these speaker ids: ${JSON.stringify(context.plan.params.__speakers ?? [])}.\n` : ''}
Source:
---
${chunk}
---`,
        temperature: 0.6,
        signal: context.signal,
      }).then((draft) => {
        // Later windows must reuse the speakers established by the first one.
        if (index === 0 && draft.speakers?.length) {
          context.plan.params.__speakers = draft.speakers.map((speaker) => speaker.id)
        }
        return draft
      }),
    )

    const speakers = drafts[0]?.speakers?.length
      ? drafts[0].speakers
      : [
          { id: 'guide', name: 'Guide', role: 'Knows the material' },
          { id: 'learner', name: 'Learner', role: 'Meeting it for the first time' },
        ]
    // A model that drifts off the ids it declared still has to land on a real
    // speaker. Most drift is cosmetic — "Nova" for `nova`, or the display name
    // instead of the id — so match on that first.
    const byLabel = new Map<string, string>()
    for (const speaker of speakers) {
      byLabel.set(speaker.id.trim().toLowerCase(), speaker.id)
      byLabel.set(speaker.name.trim().toLowerCase(), speaker.id)
    }

    let previous: string | undefined
    const turns = drafts
      .flatMap((draft) => draft.turns ?? [])
      .filter((turn) => turn.text?.trim())
      .map((turn) => {
        // Real drift falls back to whoever did not just speak: a dialogue that
        // alternates is wrong about one line, one that does not reads as a
        // monologue with the wrong name on it.
        const other = speakers.find((speaker) => speaker.id !== previous) ?? speakers[0]!
        const speaker = byLabel.get(turn.speaker?.trim().toLowerCase() ?? '') ?? other.id
        previous = speaker
        return { speaker, text: turn.text.trim() }
      })

    requireContent(turns.length, 'dialogue')

    return {
      format: 'dialogue',
      title: drafts[0]?.title?.trim() || titleOf(context),
      lang: context.lang,
      meta: baseMeta(context),
      speakers,
      turns,
    }
  },
}
