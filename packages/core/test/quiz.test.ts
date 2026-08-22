import assert from 'node:assert/strict'
import { test } from 'node:test'
import { chew } from '../dist/index.js'

const SOURCE = `# Widget Protocol

Every frame starts with a four byte header. The first byte is the version, which
must be 0x02. The next three bytes are the payload length in network byte order.
A frame whose payload exceeds 16 MiB is rejected.

## Handshake

The client sends HELLO with its supported versions and the broker replies
WELCOME with the chosen one. Either side may send PING at any time.`

/** Four questions with the right answer first — what real models hand back. */
const DRAFT = {
  questions: [1, 2, 3, 4].map((n) => ({
    kind: 'single' as const,
    prompt: `Question ${n}: which one is right?`,
    choices: [
      { id: 'a', text: `correct ${n}` },
      { id: 'b', text: `wrong ${n} one` },
      { id: 'c', text: `wrong ${n} two` },
      { id: 'd', text: `wrong ${n} three` },
    ],
    answer: ['a'],
    explanation: 'because',
    difficulty: 1,
  })),
}

function stubLlm(draft: unknown = DRAFT) {
  return {
    name: 'stub',
    complete: async () => '',
    structured: async <T>(request: { name: string }): Promise<T> =>
      (request.name === 'quiz' ? draft : {}) as T,
  }
}

async function quizFrom(draft?: unknown) {
  const { piece } = await chew({
    sources: [{ content: SOURCE, name: 'protocol.md' }],
    intent: 'quiz me',
    format: 'quiz',
    llm: stubLlm(draft),
  })
  assert.equal(piece.format, 'quiz')
  if (piece.format !== 'quiz') throw new Error('not a quiz')
  return piece
}

test('the correct choice does not sit in the same slot every time', async () => {
  const piece = await quizFrom()
  assert.equal(piece.questions.length, 4)

  for (const question of piece.questions) {
    // Wherever it moved to, the answer still points at the right text.
    const answer = question.choices?.find((choice) => choice.id === question.answer[0])
    assert.match(answer?.text ?? '', /^correct /)
    // And the reader still clicks a, b, c, d.
    assert.deepEqual(
      (question.choices ?? []).map((choice) => choice.id),
      ['a', 'b', 'c', 'd'],
    )
  }

  const slots = new Set(piece.questions.map((question) => question.answer[0]))
  assert.ok(slots.size > 1, `every answer landed in slot ${[...slots]}`)
})

test('the same draft shuffles the same way twice', async () => {
  const [first, second] = await Promise.all([quizFrom(), quizFrom()])
  assert.deepEqual(first.questions, second.questions)
})

test('a multi-choice answer set survives the shuffle, and short answers are untouched', async () => {
  const piece = await quizFrom({
    questions: [
      {
        kind: 'multi',
        prompt: 'which two hold?',
        choices: [
          { id: 'a', text: 'first right' },
          { id: 'b', text: 'second right' },
          { id: 'c', text: 'wrong' },
          { id: 'd', text: 'also wrong' },
        ],
        answer: ['a', 'b'],
        explanation: 'because',
        difficulty: 2,
      },
      {
        kind: 'short',
        prompt: 'what is the ceiling?',
        answer: ['16 MiB', '16MiB'],
        explanation: 'because',
        difficulty: 1,
      },
      {
        kind: 'single',
        prompt: 'and the version byte?',
        choices: [
          { id: 'a', text: '0x02' },
          { id: 'b', text: '0x01' },
        ],
        answer: ['a'],
        explanation: 'because',
        difficulty: 1,
      },
    ],
  })

  const [multi, short] = piece.questions
  assert.equal(multi?.answer.length, 2)
  assert.deepEqual(
    multi?.answer.map((id) => multi.choices?.find((choice) => choice.id === id)?.text).sort(),
    ['first right', 'second right'],
  )
  assert.equal(short?.kind, 'short')
  assert.deepEqual(short?.answer, ['16 MiB', '16MiB'])
  assert.equal(short?.choices, undefined)
})
