import assert from 'node:assert/strict'
import { test } from 'node:test'
import { anthropic, claudeCode, KamuError, ollama, openai, S } from '../dist/index.js'

/**
 * What each provider actually puts on the wire.
 *
 * `llm.test.ts` covers the recovery behaviour around a model that drifts from a
 * schema; this file is about the request itself — the URL, the headers, the
 * body — plus the two paths that are neither: an unusable configuration, and
 * `claude-code`, whose transport is an SDK stream rather than a fetch.
 */

const SCHEMA = S.object({ title: S.string(), count: S.integer('how many', { minimum: 1 }) }, [
  'title',
  'count',
])

interface Call {
  url: string
  init: RequestInit
  body: Record<string, unknown>
  headers: Record<string, string>
}

/** A `fetch` that replays queued replies and records what it was asked. */
function recorder(replies: Response[]) {
  const calls: Call[] = []
  const fetchImpl = (async (input: string | URL | Request, init: RequestInit = {}) => {
    const headers = Object.fromEntries(
      Object.entries((init.headers ?? {}) as Record<string, string>).map(([key, value]) => [
        key.toLowerCase(),
        value,
      ]),
    )
    calls.push({
      url: String(input),
      init,
      body: init.body ? JSON.parse(String(init.body)) : {},
      headers,
    })
    const reply = replies.shift()
    if (!reply) throw new Error(`unexpected request #${calls.length} to ${String(input)}`)
    return reply
  }) as unknown as typeof fetch

  return { calls, fetchImpl }
}

const ok = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })

const bad = (status: number, body: string) => new Response(body, { status })

const openaiText = (content: string) => ok({ choices: [{ message: { content } }] })

// --- anthropic --------------------------------------------------------------

test('anthropic sends the Messages API shape and joins the text blocks', async () => {
  const { calls, fetchImpl } = recorder([
    ok({
      content: [
        { type: 'text', text: 'first ' },
        { type: 'thinking', text: 'ignored' },
        { type: 'text', text: 'second' },
      ],
    }),
  ])

  const llm = anthropic({ apiKey: 'sk-test', model: 'claude-test', fetchImpl })
  const text = await llm.complete({ system: 'be brief', prompt: 'hello', maxTokens: 64 })

  assert.equal(text, 'first second')
  assert.equal(llm.name, 'anthropic:claude-test')
  const [call] = calls
  assert.equal(call?.url, 'https://api.anthropic.com/v1/messages')
  assert.equal(call?.headers['x-api-key'], 'sk-test')
  assert.equal(call?.headers['anthropic-version'], '2023-06-01')
  assert.deepEqual(call?.body.messages, [{ role: 'user', content: 'hello' }])
  assert.equal(call?.body.system, 'be brief')
  assert.equal(call?.body.max_tokens, 64)
})

test('anthropic asks for the schema as a forced tool call', async () => {
  const { calls, fetchImpl } = recorder([
    ok({ content: [{ type: 'tool_use', name: 'thing', input: { title: 'ok', count: 2 } }] }),
  ])

  const result = await anthropic({ apiKey: 'sk-test', fetchImpl }).structured!({
    name: 'thing',
    schema: SCHEMA,
    prompt: 'fill it in',
  })

  assert.deepEqual(result, { title: 'ok', count: 2 })
  assert.deepEqual(calls[0]?.body.tool_choice, { type: 'tool', name: 'thing' })
  const tools = calls[0]?.body.tools as { name: string; input_schema: { type: string } }[]
  assert.equal(tools[0]?.name, 'thing')
  assert.equal(tools[0]?.input_schema.type, 'object')
})

test('anthropic without a key fails before it reaches the network', () => {
  const { calls, fetchImpl } = recorder([])
  assert.throws(
    () => anthropic({ apiKey: '', fetchImpl }),
    (error: unknown) => error instanceof KamuError && error.code === 'CONFIG',
  )
  assert.equal(calls.length, 0)
})

test('anthropic reports the status and the body when the API refuses', async () => {
  const { fetchImpl } = recorder([bad(429, '{"error":{"message":"rate limited"}}')])
  await assert.rejects(
    () => anthropic({ apiKey: 'sk-test', fetchImpl }).complete({ prompt: 'hi' }),
    (error: unknown) =>
      error instanceof KamuError &&
      /429/.test(error.message) &&
      /rate limited/.test(error.hint ?? ''),
  )
})

test('an abort signal reaches the request', async () => {
  const { calls, fetchImpl } = recorder([ok({ content: [{ type: 'text', text: 'done' }] })])
  const controller = new AbortController()
  await anthropic({ apiKey: 'sk-test', fetchImpl }).complete({
    prompt: 'hi',
    signal: controller.signal,
  })
  assert.equal(calls[0]?.init.signal, controller.signal)
})

// --- openai-compatible ------------------------------------------------------

test('openai posts to chat/completions with a bearer token', async () => {
  const { calls, fetchImpl } = recorder([openaiText('hello back')])

  const llm = openai({ apiKey: 'sk-test', model: 'gpt-test', fetchImpl })
  assert.equal(await llm.complete({ system: 'sys', prompt: 'hi' }), 'hello back')
  assert.equal(llm.name, 'openai:gpt-test')
  assert.equal(calls[0]?.url, 'https://api.openai.com/v1/chat/completions')
  assert.equal(calls[0]?.headers.authorization, 'Bearer sk-test')
  assert.deepEqual(calls[0]?.body.messages, [
    { role: 'system', content: 'sys' },
    { role: 'user', content: 'hi' },
  ])
})

test('openai asks for a json_schema response and returns the parsed object', async () => {
  const { calls, fetchImpl } = recorder([openaiText('{"title":"ok","count":3}')])

  const result = await openai({ apiKey: 'sk-test', fetchImpl }).structured!({
    name: 'thing',
    schema: SCHEMA,
    prompt: 'fill it in',
  })

  assert.deepEqual(result, { title: 'ok', count: 3 })
  const format = calls[0]?.body.response_format as { type: string; json_schema: { name: string } }
  assert.equal(format.type, 'json_schema')
  assert.equal(format.json_schema.name, 'thing')
})

test('openai drops json_schema when the endpoint refuses it', async () => {
  const { calls, fetchImpl } = recorder([
    bad(400, 'response_format is not supported'),
    openaiText('Sure! {"title":"ok","count":2}'),
  ])

  const result = await openai({ apiKey: 'sk-test', fetchImpl }).structured!({
    name: 'thing',
    schema: SCHEMA,
    prompt: 'fill it in',
  })

  assert.deepEqual(result, { title: 'ok', count: 2 })
  assert.equal(calls.length, 2)
  assert.equal(calls[1]?.body.response_format, undefined)
})

test('openai carries what the schema path learned into the prompt path', async () => {
  const { calls, fetchImpl } = recorder([
    openaiText('{"title":"ok"}'),
    openaiText('{"title":"ok","count":5}'),
  ])

  const result = await openai({ apiKey: 'sk-test', fetchImpl }).structured!({
    name: 'thing',
    schema: SCHEMA,
    prompt: 'fill it in',
  })

  assert.deepEqual(result, { title: 'ok', count: 5 })
  assert.match(JSON.stringify(calls[1]?.body.messages), /A previous attempt failed with/)
  assert.match(JSON.stringify(calls[1]?.body.messages), /count/)
})

test('openai needs a key only for the hosted endpoint', () => {
  const { fetchImpl } = recorder([])
  assert.throws(
    () => openai({ apiKey: '', fetchImpl }),
    (error: unknown) => error instanceof KamuError && error.code === 'CONFIG',
  )
  assert.doesNotThrow(() => openai({ apiKey: '', baseUrl: 'http://127.0.0.1:1234/v1', fetchImpl }))
})

test('a trailing slash on the base URL does not double up', async () => {
  const { calls, fetchImpl } = recorder([openaiText('hi')])
  await openai({ apiKey: 'k', baseUrl: 'http://localhost:1234/v1/', fetchImpl }).complete({
    prompt: 'x',
  })
  assert.equal(calls[0]?.url, 'http://localhost:1234/v1/chat/completions')
})

// --- ollama -----------------------------------------------------------------

test('ollama posts a non-streaming chat request to the daemon', async () => {
  const { calls, fetchImpl } = recorder([ok({ message: { content: 'local answer' } })])

  const llm = ollama({ model: 'qwen-test', fetchImpl })
  assert.equal(await llm.complete({ prompt: 'hi' }), 'local answer')
  assert.equal(llm.name, 'ollama:qwen-test')
  assert.equal(calls[0]?.url, 'http://127.0.0.1:11434/api/chat')
  assert.equal(calls[0]?.body.stream, false)
})

test('ollama passes the schema to the daemon as a format', async () => {
  const { calls, fetchImpl } = recorder([ok({ message: { content: '{"title":"ok","count":1}' } })])

  const result = await ollama({ fetchImpl }).structured!({
    name: 'thing',
    schema: SCHEMA,
    prompt: 'fill it in',
  })

  assert.deepEqual(result, { title: 'ok', count: 1 })
  assert.equal((calls[0]?.body.format as { type: string } | undefined)?.type, 'object')
})

// --- claude-code ------------------------------------------------------------

/** The message shapes kamu reads out of the Claude Agent SDK stream. */
function stubSdk(
  messages: unknown[],
  seen: { prompt?: string; options?: Record<string, unknown> } = {},
) {
  return {
    query(params: { prompt: string; options?: Record<string, unknown> }) {
      seen.prompt = params.prompt
      seen.options = params.options
      return (async function* () {
        for (const message of messages) yield message
      })()
    },
  }
}

const assistant = (text: string) => ({
  type: 'assistant',
  message: { content: [{ type: 'text', text }] },
})

test('claude-code collects the assistant text and asks for no tools', async () => {
  const seen: { prompt?: string; options?: Record<string, unknown> } = {}
  const llm = claudeCode({
    model: 'claude-test',
    sdk: stubSdk([assistant('half '), assistant('and half')], seen),
  })

  assert.equal(await llm.complete({ system: 'be brief', prompt: 'hello' }), 'half and half')
  assert.equal(llm.name, 'claude-code:claude-test')
  assert.equal(seen.prompt, 'hello')
  assert.equal(seen.options?.model, 'claude-test')
  assert.equal(seen.options?.systemPrompt, 'be brief')
  assert.deepEqual(seen.options?.allowedTools, [])
})

test('claude-code prefers the result message when it carries the answer', async () => {
  const llm = claudeCode({
    sdk: stubSdk([assistant('draft'), { type: 'result', subtype: 'success', result: 'final' }]),
  })
  assert.equal(await llm.complete({ prompt: 'hi' }), 'final')
})

test('claude-code keeps the text it got when the run hit the turn limit', async () => {
  const llm = claudeCode({
    sdk: stubSdk([assistant('partial'), { type: 'result', subtype: 'error_max_turns' }]),
  })
  assert.equal(await llm.complete({ prompt: 'hi' }), 'partial')
})

test('claude-code explains a run that produced nothing', async () => {
  const llm = claudeCode({ sdk: stubSdk([{ type: 'result', subtype: 'error_during_execution' }]) })
  await assert.rejects(
    () => llm.complete({ prompt: 'hi' }),
    (error: unknown) =>
      error instanceof KamuError &&
      /error_during_execution/.test(error.message) &&
      /logged in/.test(error.hint ?? ''),
  )
})

test('claude-code prompts its way to a structured object', async () => {
  const seen: { prompt?: string; options?: Record<string, unknown> } = {}
  const llm = claudeCode({
    sdk: stubSdk(
      [{ type: 'result', subtype: 'success', result: '{"title":"ok","count":2}' }],
      seen,
    ),
  })

  const result = await llm.structured!({ name: 'thing', schema: SCHEMA, prompt: 'fill it in' })
  assert.deepEqual(result, { title: 'ok', count: 2 })
  assert.match(String(seen.prompt), /JSON Schema/)
})

test('claude-code passes an abort controller through when it is given a signal', async () => {
  const seen: { prompt?: string; options?: Record<string, unknown> } = {}
  const controller = new AbortController()
  const llm = claudeCode({
    sdk: stubSdk([{ type: 'result', subtype: 'success', result: 'done' }], seen),
  })

  await llm.complete({ prompt: 'hi', signal: controller.signal })
  const passed = seen.options?.abortController as AbortController
  assert.ok(passed instanceof AbortController)
  assert.equal(passed.signal.aborted, false)
  controller.abort()
  assert.equal(passed.signal.aborted, true)
})

test('claude-code names the optional package when the SDK is not installed', async (t) => {
  try {
    await import('@anthropic-ai/claude-agent-sdk')
    t.skip('the Claude Agent SDK is installed in this environment')
    return
  } catch {
    // Not installed, which is the case this test is about.
  }
  await assert.rejects(
    () => claudeCode().complete({ prompt: 'hi' }),
    (error: unknown) =>
      error instanceof KamuError &&
      error.code === 'CONFIG' &&
      /claude-agent-sdk/.test(error.message),
  )
})
