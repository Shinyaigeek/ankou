import { ask } from '../llm/index.js'
import { S } from '../schema/validate.js'
import type { Question, QuizPiece } from '../types.js'
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

const QUIZ_SCHEMA = S.object(
  {
    questions: S.array(
      S.object(
        {
          kind: S.enum(['single', 'multi', 'short'], 'Answer type.'),
          prompt: S.string('The question. Self-contained — do not say "according to the text".'),
          choices: S.array(
            S.object({ id: S.string('a, b, c, ...'), text: S.string() }, ['id', 'text']),
            'Required for single and multi. Wrong choices must be plausible, not filler.',
            { maxItems: 6 },
          ),
          answer: S.array(S.string(), 'Choice ids, or accepted answer strings for kind=short.'),
          explanation: S.string('Why the answer is right, and why a tempting wrong one is wrong.'),
          evidence: S.string('A short verbatim quote from the source that settles it.'),
          difficulty: S.integer('1 = recall, 2 = understanding, 3 = application.', {
            minimum: 1,
            maximum: 3,
          }),
        },
        ['kind', 'prompt', 'answer', 'explanation', 'difficulty'],
      ),
    ),
  },
  ['questions'],
)

interface QuizDraft {
  questions: {
    kind: 'single' | 'multi' | 'short'
    prompt: string
    choices?: { id: string; text: string }[]
    answer: string[]
    explanation: string
    evidence?: string
    difficulty: number
  }[]
}

const normalise = (text: string) => text.trim().toLowerCase()

/**
 * Make a drafted question one that can actually be marked, or drop it.
 *
 * Both renderers grade by comparing the reader's pick against `answer` as choice
 * ids, so a model that labels its choices with an empty string — or answers with
 * the choice *text* instead of its id — produces a quiz that marks the right
 * answer wrong. That is worse than a missing question, so the ids are reassigned
 * here and the answers are rewritten to match, and anything still unmatched at
 * the end takes the question with it.
 */
function gradeable(draft: QuizDraft['questions'][number]): Omit<Question, 'id'> | null {
  const kind = draft.kind ?? 'single'
  const base = {
    kind,
    prompt: draft.prompt.trim(),
    explanation: draft.explanation ?? '',
    ...(draft.evidence ? { evidence: draft.evidence } : {}),
    difficulty: clamp(Math.round(draft.difficulty ?? 2), 1, 3) as 1 | 2 | 3,
  }

  // Short answers are free text and have nothing to reconcile against.
  const drafted = (draft.choices ?? []).filter((choice) => choice.text?.trim())
  if (kind === 'short' || drafted.length === 0) {
    const answer = draft.answer.map(String).filter((text) => text.trim())
    return answer.length > 0 ? { ...base, kind: 'short', answer } : null
  }

  const choices = drafted.map((choice, index) => ({
    id: String.fromCharCode(97 + index).slice(0, 1),
    text: choice.text.trim(),
  }))
  // Whatever the model called a choice — its own id, or the text of it — has to
  // end up pointing at the letter the reader will click.
  const byLabel = new Map<string, string>()
  drafted.forEach((choice, index) => {
    const id = choices[index]!.id
    if (choice.id?.trim()) byLabel.set(normalise(choice.id), id)
    byLabel.set(normalise(choice.text), id)
    byLabel.set(id, id)
  })

  const answer = [
    ...new Set(
      draft.answer
        .map((entry) => byLabel.get(normalise(String(entry))))
        .filter((id): id is string => id !== undefined),
    ),
  ]
  if (answer.length === 0) return null

  // A single-choice question with several answers cannot be got right: the
  // reader can only pick one. Take the model at its word about the kind.
  return { ...base, choices, answer: kind === 'single' ? [answer[0]!] : answer }
}

export const quiz: FormatModule<'quiz'> = {
  id: 'quiz',
  label: 'Quiz',
  description:
    'Questions with answers, explanations and a quote from the source. Tests whether the material actually stuck.',
  bestFor: [
    'memorising or revising material',
    'checking your understanding after reading',
    'exam or interview preparation',
    'active recall instead of passive rereading',
  ],
  params: {
    questionCount: { type: 'integer', description: 'How many questions to produce.' },
    difficulty: { type: 'integer', description: '1 = recall, 2 = understanding, 3 = application.' },
  },

  async compose(context): Promise<QuizPiece> {
    const total = clamp(
      param(context.plan, 'questionCount', scaleToLength(joinedText(context), 1.2, 5, 30)),
      3,
      60,
    )
    const difficulty = param<number | undefined>(context.plan, 'difficulty', undefined)

    const drafts = await mapWindows(context, async (chunk, index, count) => {
      const share = Math.max(2, Math.round(total / count))
      return ask<QuizDraft>(context.llm, {
        name: 'quiz',
        schema: QUIZ_SCHEMA,
        system: systemPrompt(
          context,
          'You write quizzes that make a reader think, not ones they can pass by pattern-matching the longest option. Distractors must be things a half-attentive reader would genuinely believe.',
        ),
        prompt: `The reader's intent: ${context.intent}
${difficulty ? `Aim for difficulty level ${difficulty}.\n` : ''}
${count > 1 ? `This is part ${index + 1} of ${count} of a longer document. Ask only about this part.\n` : ''}
Write about ${share} questions. Mix kinds; favour single-choice unless the material suits otherwise.
Every question must be answerable from the source alone.

Source:
---
${chunk}
---`,
        temperature: 0.5,
        signal: context.signal,
      })
    })

    const questions: Question[] = drafts
      .flatMap((draft) => draft.questions ?? [])
      .filter((question) => question.prompt?.trim() && question.answer?.length)
      .map(gradeable)
      .filter((question): question is Omit<Question, 'id'> => question !== null)
      .slice(0, total)
      .map((question, index) => ({ id: `q${index + 1}`, ...question }))

    requireContent(questions.length, 'questions')

    return {
      format: 'quiz',
      title: titleOf(context),
      lang: context.lang,
      meta: baseMeta(context),
      questions,
      passScore: Math.max(1, Math.ceil(questions.length * 0.7)),
    }
  },
}
