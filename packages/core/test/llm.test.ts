import assert from 'node:assert/strict'
import { test } from 'node:test'
import { anthropic, KamuError, ollama, S } from '../dist/index.js'
import { extractJson, structuredViaPrompt } from '../dist/llm/json.js'

const PACING = S.object(
  {
    baseMs: S.number('milliseconds per character', { minimum: 8, maximum: 400 }),
    note: S.string(),
  },
  ['baseMs'],
)

/** A fetch stub that replays canned bodies and records what it was asked. */
function fakeFetch(replies: (string | { status: number; body: string })[]) {
  const calls: Record<string, unknown>[] = []
  const impl = async (_url: string, init: { body: string }) => {
    calls.push(JSON.parse(init.body))
    const reply = replies.shift()
    assert.ok(reply !== undefined, 'the provider made more calls than the test expected')
    if (typeof reply !== 'string') {
      return new Response(reply.body, { status: reply.status })
    }
    return new Response(reply, { status: 200 })
  }
  return { impl: impl as unknown as typeof fetch, calls }
}

const ollamaSays = (content: string) => JSON.stringify({ message: { content } })

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

test('structuredViaPrompt hands the model its own errors before giving up', async () => {
  const prompts: string[] = []
  const llm = {
    name: 'stub',
    async complete(request: { prompt: string }) {
      prompts.push(request.prompt)
      return prompts.length === 1 ? '{"baseMs":1}' : '{"baseMs":60}'
    },
  }
  const value = await structuredViaPrompt<{ baseMs: number }>(llm as never, {
    name: 'pacing',
    schema: PACING,
    prompt: 'pace it',
  })
  assert.equal(value.baseMs, 60)
  assert.ok(prompts[1]?.includes('must be >= 8'), 'the retry should quote the failure')
})

test('ollama carries a near-miss from the schema path into the prompt path', async () => {
  // The grammar keeps the shape but not the bounds, so this is the common case:
  // a reply that is the right shape and out of range.
  const { impl, calls } = fakeFetch([ollamaSays('{"baseMs":1}'), ollamaSays('{"baseMs":60}')])
  const llm = ollama({ model: 'test', fetchImpl: impl })

  const value = await llm.structured!<{ baseMs: number }>({
    name: 'pacing',
    schema: PACING,
    prompt: 'pace it',
  })

  assert.equal(value.baseMs, 60)
  assert.ok(calls[0]?.format, 'the first call should use the native schema path')
  assert.equal(calls[1]?.format, undefined, 'the fallback should ask in prose')
  const retry = (calls[1]!.messages as { content: string }[]).at(-1)!.content
  assert.ok(retry.includes('must be >= 8'), 'the fallback should not start the model over blind')
})

test('ollama falls back when the daemon rejects the schema, not when it is absent', async () => {
  const rejects = fakeFetch([
    { status: 400, body: 'unsupported format' },
    ollamaSays('{"baseMs":60}'),
  ])
  const value = await ollama({ model: 'test', fetchImpl: rejects.impl }).structured!<{
    baseMs: number
  }>({ name: 'pacing', schema: PACING, prompt: 'pace it' })
  assert.equal(value.baseMs, 60)

  const unreachable = (async () => {
    throw new TypeError('fetch failed')
  }) as unknown as typeof fetch
  await assert.rejects(
    () =>
      ollama({ model: 'test', fetchImpl: unreachable }).structured!({
        name: 'pacing',
        schema: PACING,
        prompt: 'pace it',
      }),
    (error: unknown) =>
      error instanceof KamuError && /Cannot reach Ollama/.test((error as Error).message),
  )
})

test('anthropic repairs an out-of-range tool result instead of abandoning the run', async () => {
  const { impl, calls } = fakeFetch([
    JSON.stringify({
      content: [{ type: 'tool_use', name: 'pacing', input: { baseMs: 1000 } }],
    }),
    JSON.stringify({ content: [{ type: 'text', text: '{"baseMs":60}' }] }),
  ])
  const value = await anthropic({ apiKey: 'k', model: 'test', fetchImpl: impl }).structured!<{
    baseMs: number
  }>({ name: 'pacing', schema: PACING, prompt: 'pace it' })

  assert.equal(value.baseMs, 60)
  assert.ok(calls[0]?.tools, 'the first call should use tool use')
  const retry = (calls[1]!.messages as { content: string }[])[0]!.content
  assert.ok(retry.includes('must be <= 400'))
})
