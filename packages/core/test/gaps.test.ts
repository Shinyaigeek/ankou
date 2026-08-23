import assert from 'node:assert/strict'
import { test } from 'node:test'
import { gaps } from '../dist/index.js'
import type { Document } from '../dist/types.js'

const doc = (text: string): Document => ({
  id: 'd1',
  title: 'T',
  origin: { kind: 'markdown', ref: 'test.md' },
  text,
  sections: [{ title: '', text }],
  meta: {},
  charCount: text.length,
  lang: 'en',
})

test('an acronym the document never spells out is a lead', () => {
  const found = gaps([doc('The MTBF target is fixed. MTBF matters here.')])
  const acronyms = found.filter((gap) => gap.kind === 'acronym')
  assert.equal(acronyms.length, 1)
  assert.equal(acronyms[0]?.text, 'MTBF')
  assert.equal(acronyms[0]?.count, 2)
  assert.match(acronyms[0]?.context ?? '', /MTBF target/)
})

test('an acronym the document does spell out is not', () => {
  const before = gaps([doc('Mean Time Between Failures (MTBF) is the target.')])
  const after = gaps([doc('MTBF (Mean Time Between Failures) is the target.')])
  for (const found of [before, after]) {
    assert.deepEqual(
      found.filter((gap) => gap.kind === 'acronym'),
      [],
    )
  }
})

test('everyday acronyms are not worth anyone looking up', () => {
  const found = gaps([doc('The API returns JSON over HTTPS, described in the README.')])
  assert.deepEqual(
    found.filter((gap) => gap.kind === 'acronym').map((gap) => gap.text),
    [],
  )
})

test('citations, links and pointers are separate kinds of lead', () => {
  const found = gaps([
    doc(
      [
        'Caching follows RFC 7231 and ISO 8601 timestamps.',
        'Background: https://example.com/design-notes and arXiv: 2401.01234.',
        'See the Ingest Service for how sources arrive.',
      ].join('\n'),
    ),
  ])
  const kinds = (kind: string) => found.filter((gap) => gap.kind === kind).map((gap) => gap.text)
  assert.ok(kinds('citation').some((text) => /RFC\s?7231/i.test(text)))
  assert.ok(kinds('citation').some((text) => /ISO\s?8601/i.test(text)))
  assert.deepEqual(kinds('link'), ['https://example.com/design-notes'])
  assert.ok(kinds('pointer').some((text) => /Ingest Service/.test(text)))
})

test('a trailing full stop is not part of the URL', () => {
  const [link] = gaps([doc('Read https://example.com/spec.html.')]).filter(
    (gap) => gap.kind === 'link',
  )
  assert.equal(link?.text, 'https://example.com/spec.html')
})

test('leads come back most-leaned-on first, and can be trimmed', () => {
  const text = 'ZQX ZQX ZQX and WVY WVY and PLM once.'
  const found = gaps([doc(text)])
  assert.deepEqual(
    found.map((gap) => gap.text),
    ['ZQX', 'WVY', 'PLM'],
  )
  assert.deepEqual(
    gaps([doc(text)], { minCount: 2 }).map((gap) => gap.text),
    ['ZQX', 'WVY'],
  )
  assert.equal(gaps([doc(text)], { limit: 1 }).length, 1)
})
