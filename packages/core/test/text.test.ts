import assert from 'node:assert/strict'
import { test } from 'node:test'
import { graphemes, windows } from '../dist/index.js'
import * as term from '../dist/render/tui/term.js'
import { detectLang, normaliseText, shortHash } from '../dist/util/text.js'

test('graphemes keeps surrogate pairs and combining marks whole', () => {
  assert.deepEqual(graphemes('a👨‍👩‍👧b').length <= 3, true)
  assert.deepEqual(graphemes('日本語'), ['日', '本', '語'])
})

test('detectLang recognises Japanese and English', () => {
  assert.equal(detectLang('これは日本語の文章です。'), 'ja')
  assert.equal(detectLang('This is an English sentence about nothing.'), 'en')
})

test('normaliseText collapses blank line runs and CRLF', () => {
  assert.equal(normaliseText('a\r\n\r\n\r\n\r\nb  \n'), 'a\n\nb')
})

test('windows splits on paragraph boundaries and covers the whole text', () => {
  const text = Array.from({ length: 40 }, (_, i) => `paragraph number ${i} with some words`).join(
    '\n\n',
  )
  const parts = windows(text, 200)
  assert.ok(parts.length > 1)
  for (const part of parts) assert.ok(part.length <= 400)
  assert.ok(parts.join('').includes('paragraph number 39'))
})

test('windows returns the text unchanged when it fits', () => {
  assert.deepEqual(windows('short', 100), ['short'])
})

test('charWidth treats CJK as two cells and ASCII as one', () => {
  assert.equal(term.charWidth('あ'.codePointAt(0)!), 2)
  assert.equal(term.charWidth('a'.codePointAt(0)!), 1)
})

test('wrap respects the display width of Japanese text', () => {
  const lines = term.wrap('あ'.repeat(20), 10)
  assert.equal(lines.length, 4)
  for (const line of lines) assert.ok([...line].length <= 5)
})

test('wrap breaks Latin text on spaces', () => {
  const lines = term.wrap('the quick brown fox jumps over the lazy dog', 12)
  for (const line of lines) assert.ok(line.length <= 12)
  assert.ok(lines.every((line) => !line.startsWith(' ')))
})

test('shortHash is stable and differs between inputs', () => {
  assert.equal(shortHash('abc'), shortHash('abc'))
  assert.notEqual(shortHash('abc'), shortHash('abd'))
})

test('wrap measures what is on screen, not the escapes that colour it', () => {
  const ESC = String.fromCharCode(27)
  const sentence = 'unreliable channel and the messengers between the two generals may be captured'
  const painted = `${ESC}[38;5;208munreliable${ESC}[0m${sentence.slice('unreliable'.length)}`

  // Same text, same width on screen; it has to break in the same places.
  assert.equal(term.width(painted), term.width(sentence))
  assert.deepEqual(
    term.wrap(painted, 60).map((line) => term.stripAnsi(line)),
    term.wrap(sentence, 60),
  )
})

test('wrap keeps a painted run painted across the break', () => {
  const ESC = String.fromCharCode(27)
  const long = `${ESC}[38;5;244m${'word '.repeat(30).trim()}${ESC}[0m`
  const lines = term.wrap(long, 40)

  assert.ok(lines.length > 2, 'nothing to test if it fits on one line')
  for (const line of lines) {
    assert.ok(term.width(line) <= 40, `${term.width(line)} columns is over the measure`)
    // Closed at the end of the line and reopened on the next, or the colour
    // stops after the first line and the reset lands somewhere useless.
    assert.ok(line.startsWith(`${ESC}[38;5;244m`), 'the style was not reopened')
    assert.ok(line.endsWith(`${ESC}[0m`), 'the style was left open')
  }
  assert.equal(term.stripAnsi(lines.join(' ')), term.stripAnsi(long), 'the text itself changed')
})

test('windows always advances, whatever window and overlap it is given', () => {
  const text = 'A paragraph of text that is long enough to matter. '.repeat(40)

  // `--window 200` used to hang here: composition always asks for 200 characters
  // of overlap, so the next window started exactly where the last one did.
  for (const [budget, overlap] of [
    [24_000, 200],
    [500, 200],
    [200, 200],
    [150, 200],
    [1, 200],
    [0, 0],
  ] as [number, number][]) {
    const out = windows(text, budget, overlap)
    assert.ok(out.length > 0, `${budget}/${overlap} produced nothing`)
    assert.ok(
      out.every((window) => window.length > 0),
      `${budget}/${overlap} produced an empty window`,
    )
    assert.ok(out.join('').includes(text.slice(0, 40)), `${budget}/${overlap} lost the opening`)
  }
})

test('windows never cuts a character in half', () => {
  const emoji = '👩‍👩‍👧‍👦 家族と🇯🇵と絵文字がたくさん並ぶ段落です。'.repeat(40)
  const out = windows(emoji, 200, 50)
  assert.ok(out.length > 1, 'nothing to test if it all fits')
  const lone = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/
  for (const window of out) {
    assert.ok(!lone.test(window), 'a surrogate pair was split across windows')
  }
})
