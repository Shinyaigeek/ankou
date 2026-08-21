import assert from 'node:assert/strict'
import { test } from 'node:test'
import { S, validate } from '../dist/index.js'
import { extractJson } from '../dist/llm/json.js'

const SCHEMA = S.object(
  {
    name: S.string(),
    count: S.integer('how many', { minimum: 1, maximum: 5 }),
    kind: S.enum(['a', 'b']),
    items: S.array(S.object({ id: S.string() }, ['id']), 'things', { minItems: 1 }),
  },
  ['name', 'count', 'kind', 'items'],
)

test('validate accepts a conforming object', () => {
  assert.deepEqual(validate({ name: 'x', count: 3, kind: 'a', items: [{ id: '1' }] }, SCHEMA), [])
})

test('validate reports missing properties and wrong types with paths', () => {
  const errors = validate({ count: 'three', kind: 'c', items: [] }, SCHEMA)
  assert.ok(errors.some((error) => error.includes('$.name')))
  assert.ok(errors.some((error) => error.includes('$.count')))
  assert.ok(errors.some((error) => error.includes('$.kind')))
  assert.ok(errors.some((error) => error.includes('$.items')))
})

test('validate checks numeric bounds and nested items', () => {
  assert.ok(validate({ name: 'x', count: 9, kind: 'a', items: [{ id: '1' }] }, SCHEMA).length > 0)
  assert.ok(
    validate({ name: 'x', count: 2, kind: 'a', items: [{}] }, SCHEMA)[0]?.includes('items[0].id'),
  )
})

test('extractJson finds the object inside prose and code fences', () => {
  assert.equal(extractJson('here you go:\n```json\n{"a":1}\n```\nhope that helps'), '{"a":1}')
  assert.equal(extractJson('prefix {"a":{"b":[1,2]}} suffix'), '{"a":{"b":[1,2]}}')
  assert.equal(extractJson('no json here'), null)
})

test('extractJson is not confused by braces inside strings', () => {
  assert.equal(extractJson('{"a":"}"}'), '{"a":"}"}')
})
