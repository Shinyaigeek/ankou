import assert from 'node:assert/strict'
import { test } from 'node:test'
import { graphemes, windows } from '../dist/index.js'
import { charWidth, wrap } from '../dist/render/tui/term.js'
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
  assert.equal(charWidth('あ'.codePointAt(0)!), 2)
  assert.equal(charWidth('a'.codePointAt(0)!), 1)
})

test('wrap respects the display width of Japanese text', () => {
  const lines = wrap('あ'.repeat(20), 10)
  assert.equal(lines.length, 4)
  for (const line of lines) assert.ok([...line].length <= 5)
})

test('wrap breaks Latin text on spaces', () => {
  const lines = wrap('the quick brown fox jumps over the lazy dog', 12)
  for (const line of lines) assert.ok(line.length <= 12)
  assert.ok(lines.every((line) => !line.startsWith(' ')))
})

test('shortHash is stable and differs between inputs', () => {
  assert.equal(shortHash('abc'), shortHash('abc'))
  assert.notEqual(shortHash('abc'), shortHash('abd'))
})
