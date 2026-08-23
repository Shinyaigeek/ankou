import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { PassThrough, Writable } from 'node:stream'
import { test } from 'node:test'
import type { Piece } from '../dist/index.js'
import { playTui } from '../dist/index.js'

const ESC = String.fromCharCode(27)
const KEY = {
  right: `${ESC}[C`,
  left: `${ESC}[D`,
  up: `${ESC}[A`,
  down: `${ESC}[B`,
  enter: '\r',
  space: ' ',
  quit: 'q',
}

/**
 * Drive the player with fake streams and read back what it drew.
 *
 * `playTui` takes its input and output as options precisely so it can be driven
 * without a terminal; nothing here was reaching that until now.
 */
function harness({ columns = 80, rows = 24 } = {}) {
  const input = new PassThrough() as unknown as NodeJS.ReadStream
  ;(input as { isTTY?: boolean }).isTTY = false
  const frames: string[] = []
  const output = new Writable({
    write(chunk, _encoding, done) {
      frames.push(String(chunk))
      done()
    },
  }) as unknown as NodeJS.WriteStream
  ;(output as { columns?: number }).columns = columns
  ;(output as { rows?: number }).rows = rows

  const strip = (text: string) =>
    text
      .split(ESC)
      .map((part, index) => (index === 0 ? part : part.replace(/^\[[0-9;?]*[A-Za-z]/, '')))
      .join('')

  return {
    input,
    output,
    press: (...keys: string[]) => {
      for (const key of keys) (input as unknown as PassThrough).write(key)
    },
    drawn: () => strip(frames.join('')),
    frames,
  }
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 15))
const meta = { sources: [], intent: 'i', generatedAt: '', model: 'stub' } as Piece['meta']

const PIECES: Piece[] = [
  {
    format: 'flipbook',
    title: '契約書',
    lang: 'ja',
    meta,
    chapters: [
      { title: '第一条', text: '甲は乙に報酬を支払う。' },
      { title: '第二条', text: '乙は業務を遂行する。' },
    ],
    emphasis: [{ term: '報酬', weight: 2 }],
    ruby: [],
    pacing: { baseMs: 1, punctuationMs: 2, paragraphMs: 3 },
  },
  {
    format: 'slides',
    title: 'Deck',
    lang: 'en',
    meta,
    slides: [
      { title: 'One', bullets: ['first point'] },
      { title: 'Two', bullets: ['second point'] },
    ],
  },
  {
    format: 'animation',
    title: 'Anim',
    lang: 'en',
    meta,
    scenes: [{ lines: [{ text: 'landing' }], motion: 'fade', durationMs: 5, holdMs: 5 }],
  },
  {
    format: 'summary',
    title: 'Sum',
    lang: 'en',
    meta,
    tldr: 'the short of it',
    keyPoints: [{ text: 'point one' }],
    outline: [],
    glossary: [],
    openQuestions: [],
  },
  {
    format: 'dialogue',
    title: 'Talk',
    lang: 'en',
    meta,
    speakers: [{ id: 'a', name: 'Ada', role: 'teacher' }],
    turns: [{ speaker: 'a', text: 'a spoken line' }],
  },
]

test('every interactive format draws something and quits on q', async () => {
  for (const piece of PIECES) {
    const screen = harness()
    const done = playTui(piece, { input: screen.input, output: screen.output, colour: false })
    await settle()
    screen.press(KEY.quit)
    await done

    const drawn = screen.drawn()
    assert.ok(drawn.includes(piece.title), `${piece.format} never drew its title`)
    assert.ok(drawn.includes('quit'), `${piece.format} never offered a way out`)
  }
})

test('the flipbook reveals the source one character at a time', async () => {
  const screen = harness()
  const piece = PIECES[0]!
  const done = playTui(piece, { input: screen.input, output: screen.output, colour: false })
  await settle()
  screen.press(KEY.space) // pause wherever it got to
  screen.press(KEY.right, KEY.right)
  await settle()
  screen.press(KEY.quit)
  await done

  const drawn = screen.drawn()
  assert.match(drawn, /1\/\d+|2\/\d+|\d+\/\d+/, 'no progress counter')
  assert.ok(drawn.includes('甲'), 'the source never appeared')
  assert.ok(drawn.includes('第一条'), 'the chapter title never appeared')
})

test('the quiz grades what you actually answered', async () => {
  const quiz: Piece = {
    format: 'quiz',
    title: 'Quiz',
    lang: 'en',
    meta,
    passScore: 1,
    questions: [
      {
        id: 'q1',
        kind: 'single',
        prompt: 'Pick beta',
        choices: [
          { id: 'a', text: 'alpha' },
          { id: 'b', text: 'beta' },
        ],
        answer: ['b'],
        explanation: 'beta it is',
        difficulty: 1,
      },
      {
        id: 'q2',
        kind: 'short',
        prompt: 'Type ankou',
        answer: ['ankou'],
        explanation: 'yes',
        difficulty: 1,
      },
    ],
  }
  const screen = harness()
  const done = playTui(quiz, { input: screen.input, output: screen.output, colour: false })
  await settle()
  screen.press('b', KEY.enter)
  await settle()
  screen.press(KEY.enter)
  await settle()
  screen.press('a', 'n', 'k', 'o', 'u', KEY.enter)
  await settle()
  screen.press(KEY.enter)
  await settle()
  screen.press(KEY.quit)
  await done

  const drawn = screen.drawn()
  assert.ok(drawn.includes('beta it is'), 'never explained the first answer')
  assert.ok(
    drawn.includes('score 2') || drawn.includes('2 / 2'),
    `no full score in:\n${drawn.slice(-400)}`,
  )
})

test('a session leaves the process as it found it', async () => {
  const before = process.listenerCount('SIGINT')
  for (let round = 0; round < 3; round++) {
    const screen = harness()
    const done = playTui(PIECES[4]!, {
      input: screen.input,
      output: screen.output,
      colour: false,
    })
    screen.press(KEY.quit)
    await done
  }
  // Each play used to leave its SIGINT handler behind, so an SDK caller playing
  // a hundred pieces collected a hundred of them and Node's listener warning.
  assert.equal(process.listenerCount('SIGINT'), before)
})

test('an empty emphasis term does not hang the player', () => {
  // `indexOf('')` answers `from` forever. A piece can arrive from anywhere —
  // `ankou render piece.json --play` reads one off disk — so this has to be a
  // failure, not a spin. Run it out of process: a hang is not a test result.
  const script = `
    const { PassThrough, Writable } = require('node:stream')
    import('${new URL('../dist/index.js', import.meta.url).href}').then(async (ankou) => {
      const input = new PassThrough(); input.isTTY = false
      const output = new Writable({ write(c, e, d) { d() } })
      output.columns = 80; output.rows = 24
      const done = ankou.playTui({
        format: 'flipbook', title: 't', lang: 'en',
        meta: { sources: [], intent: '', generatedAt: '', model: '' },
        chapters: [{ title: 'c', text: 'hello world' }],
        emphasis: [{ term: '', weight: 2 }], ruby: [],
        pacing: { baseMs: 1, punctuationMs: 1, paragraphMs: 1 },
      }, { input, output, colour: false })
      input.write('q')
      await done
      process.exit(0)
    })`
  assert.doesNotThrow(
    () => execFileSync(process.execPath, ['-e', script], { timeout: 10_000, stdio: 'ignore' }),
    'the player spun on an empty emphasis term',
  )
})
