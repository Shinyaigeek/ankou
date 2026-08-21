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
    questionCount: 'How many questions to produce.',
    difficulty: '1 = recall, 2 = understanding, 3 = application.',
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
      .map((question, index) => ({
        id: `q${index + 1}`,
        kind: question.kind ?? 'single',
        prompt: question.prompt.trim(),
        ...(question.choices?.length ? { choices: question.choices } : {}),
        answer: question.answer.map(String),
        explanation: question.explanation ?? '',
        ...(question.evidence ? { evidence: question.evidence } : {}),
        difficulty: clamp(Math.round(question.difficulty ?? 2), 1, 3) as 1 | 2 | 3,
      }))
      .slice(0, total)

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
