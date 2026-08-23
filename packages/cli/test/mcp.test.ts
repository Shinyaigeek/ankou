import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { PassThrough } from 'node:stream'
import { test } from 'node:test'
import { runMcpServer } from '../dist/mcp/server.js'

/**
 * A client on the other end of the stdio pair, close enough to a real one that
 * the tests exercise the protocol rather than the functions behind it.
 */
function client() {
  const toServer = new PassThrough()
  const fromServer = new PassThrough()
  const replies = new Map<number, (message: Record<string, any>) => void>()
  let buffer = ''
  let id = 0

  fromServer.setEncoding('utf8')
  fromServer.on('data', (chunk: string) => {
    buffer += chunk
    let cut = buffer.indexOf('\n')
    while (cut !== -1) {
      const line = buffer.slice(0, cut).trim()
      buffer = buffer.slice(cut + 1)
      if (line) {
        const message = JSON.parse(line)
        replies.get(message.id)?.(message)
        replies.delete(message.id)
      }
      cut = buffer.indexOf('\n')
    }
  })

  const done = runMcpServer(toServer, fromServer)

  const send = (method: string, params: unknown): Promise<Record<string, any>> =>
    new Promise((resolve) => {
      id += 1
      replies.set(id, resolve)
      toServer.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`)
    })

  const call = async (name: string, args: Record<string, unknown>) => {
    const reply = await send('tools/call', { name, arguments: args })
    assert.equal(reply.error, undefined, `tool ${name} errored: ${reply.error?.message}`)
    const text = reply.result.content[0].text
    return {
      isError: Boolean(reply.result.isError),
      value: reply.result.isError ? text : JSON.parse(text),
    }
  }

  return {
    send,
    call,
    raw: (line: string) => toServer.write(`${line}\n`),
    async close() {
      toServer.end()
      await done
    },
  }
}

const SOURCE = {
  content:
    '# Windows\n\nThe MTBF budget is fixed. See the Ingest Service for how sources arrive.\n',
  name: 'note.md',
}

test('it introduces itself and lists its tools', async () => {
  const mcp = client()
  const hello = await mcp.send('initialize', { protocolVersion: '2025-06-18', capabilities: {} })
  assert.equal(hello.result.serverInfo.name, 'ankou')
  assert.equal(hello.result.protocolVersion, '2025-06-18')
  assert.ok(hello.result.instructions.includes('ankou_carve_answer'))

  const listed = await mcp.send('tools/list', {})
  const names = listed.result.tools.map((tool: { name: string }) => tool.name)
  for (const expected of ['ankou_ingest', 'ankou_gaps', 'ankou_carve_start', 'ankou_render']) {
    assert.ok(names.includes(expected), `missing ${expected}`)
  }
  await mcp.close()
})

test('ingest maps the document without handing over its body', async () => {
  const mcp = client()
  const { value } = await mcp.call('ankou_ingest', { sources: [SOURCE] })
  assert.match(value.docId, /^doc-/)
  assert.equal(value.documents[0].charCount > 0, true)
  assert.equal(JSON.stringify(value).includes('MTBF budget'), false)

  const read = await mcp.call('ankou_read', { docId: value.docId, window: 0 })
  assert.match(read.value.text, /MTBF budget/)

  const leads = await mcp.call('ankou_gaps', { docId: value.docId })
  const kinds = leads.value.map((gap: { kind: string; text: string }) => `${gap.kind}:${gap.text}`)
  assert.ok(kinds.includes('acronym:MTBF'))
  await mcp.close()
})

test('a carve parks on the model, and ankou keeps the rest of the work', async () => {
  const mcp = client()
  const started = await mcp.call('ankou_carve_start', {
    sources: [SOURCE],
    intent: '一字一句読みたい',
    format: 'flipbook',
  })
  assert.equal(started.value.state, 'awaiting-model')
  assert.equal(started.value.request.name, 'flipbook_annotations')
  assert.ok(started.value.request.schema.properties.emphasis)

  // The model half, answered here. Note what is *not* in it: the body.
  const finished = await mcp.call('ankou_carve_answer', {
    carveId: started.value.carveId,
    output: {
      title: 'Windows',
      chapterTitles: ['Windows'],
      emphasis: [{ term: 'MTBF', weight: 2 }],
      ruby: [],
      pacing: { baseMs: 50 },
    },
  })
  assert.equal(finished.value.state, 'done')
  assert.equal(finished.value.format, 'flipbook')
  // Verbatim, because the renderer sliced it out of the source, not the answer.
  assert.match(finished.value.piece.chapters[0].text, /The MTBF budget is fixed\./)

  const rendered = await mcp.call('ankou_render', {
    piece: started.value.carveId,
    renderer: 'html',
  })
  assert.equal(rendered.value.format, 'flipbook')
  const html = await readFile(rendered.value.path, 'utf8')
  assert.match(html, /The MTBF budget is fixed\./)
  await mcp.close()
})

test('an answer the schema rejects costs a retry, not the carve', async () => {
  const mcp = client()
  const started = await mcp.call('ankou_carve_start', {
    sources: [SOURCE],
    intent: 'quiz me',
    format: 'quiz',
  })
  const rejected = await mcp.call('ankou_carve_answer', {
    carveId: started.value.carveId,
    output: { questions: 'plenty' },
  })
  assert.equal(rejected.value.state, 'rejected')
  assert.match(rejected.value.problems.join(' '), /questions/)

  const accepted = await mcp.call('ankou_carve_answer', {
    carveId: started.value.carveId,
    output: {
      questions: [
        {
          kind: 'short',
          prompt: 'What is fixed?',
          answer: ['the MTBF budget'],
          explanation: 'It says so.',
          difficulty: 1,
        },
      ],
    },
  })
  assert.equal(accepted.value.state, 'done')
  await mcp.close()
})

test('it answers for itself when a caller gets it wrong', async () => {
  const mcp = client()
  const unknown = await mcp.send('tools/call', { name: 'ankou_nope', arguments: {} })
  assert.equal(unknown.error.code, -32602)

  // A caller mistake the model can fix comes back as a readable tool result,
  // not a protocol error it may never be shown.
  const missing = await mcp.call('ankou_read', { docId: 'doc-nope' })
  assert.equal(missing.isError, true)
  assert.match(missing.value, /ankou_ingest/)

  const unrenderable = await mcp.call('ankou_render', { piece: { format: 'quiz' } })
  assert.equal(unrenderable.isError, true)
  assert.match(unrenderable.value, /title|meta\.sources/)

  const method = await mcp.send('tools/nonsense', {})
  assert.equal(method.error.code, -32601)
  await mcp.close()
})

test('a broken line is answered, not fatal', async () => {
  const mcp = client()
  const parsed = new Promise<Record<string, any>>((resolve) => {
    mcp.raw('{ not json')
    setTimeout(() => resolve({} as Record<string, any>), 50)
  })
  await parsed
  // The loop is still up afterwards.
  const hello = await mcp.send('ping', {})
  assert.deepEqual(hello.result, {})
  await mcp.close()
})
