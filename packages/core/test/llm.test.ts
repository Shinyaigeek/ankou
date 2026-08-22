import assert from 'node:assert/strict'
import { test } from 'node:test'
import { extractJson } from '../dist/llm/json.js'

test('extractJson repairs a reply that was cut off mid-array', () => {
  // Everything that arrived is kept, including the half-written last element;
  // what the caller does about a partial element is the schema's business.
  const repaired = extractJson('{"title":"x","items":[{"term":"a","weight":1},{"term":"b","wei')
  assert.deepEqual(JSON.parse(repaired!), {
    title: 'x',
    items: [{ term: 'a', weight: 1 }, { term: 'b' }],
  })
  assert.deepEqual(JSON.parse(extractJson('{"chapterTitles":["one","two","thr')!), {
    chapterTitles: ['one', 'two', 'thr'],
  })
})

test('extractJson closes a reply that was cut off inside a string', () => {
  const repaired = extractJson('{"tldr":"the point is that it neve')
  assert.deepEqual(JSON.parse(repaired!), { tldr: 'the point is that it neve' })
})

test('extractJson still gives up on text with no JSON in it at all', () => {
  assert.equal(extractJson('I am afraid I cannot do that.'), null)
  // An opening brace and nothing else recovers nothing, so it is not JSON.
  assert.equal(extractJson('{'), null)
  assert.equal(extractJson('here it comes: {"'), null)
})
