import assert from 'node:assert/strict'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { charsetFromMeta, decodeBytes, ingest, KamuError } from '../dist/index.js'

const SJIS_HTML =
  '<!doctype html><html><head><meta charset="Shift_JIS"><title>契約書</title></head>' +
  '<body><article><h1>契約書の第一条</h1><p>甲は乙に対し、毎月末日までに報酬を支払うものとする。' +
  '天災その他の不可抗力による遅延については、この限りではない。</p></article></body></html>'

/**
 * Node can decode Shift_JIS but not encode it, and a hand-written byte table in
 * a test is a second thing to get wrong. Build the reverse map from the decoder
 * itself, so the fixture is correct by construction.
 */
const toShiftJis = (() => {
  const decoder = new TextDecoder('shift_jis', { fatal: true })
  const map = new Map<string, number[]>()
  for (let byte = 0x20; byte < 0x80; byte++) map.set(String.fromCharCode(byte), [byte])
  for (let lead = 0x81; lead <= 0xef; lead++) {
    for (let trail = 0x40; trail <= 0xfc; trail++) {
      try {
        const char = decoder.decode(Uint8Array.from([lead, trail]))
        if (char.length === 1 && !map.has(char)) map.set(char, [lead, trail])
      } catch {
        // Not a valid pair in this encoding.
      }
    }
  }
  return (text: string): Uint8Array => {
    const bytes: number[] = []
    for (const char of text) {
      const encoded = char === '\n' ? [0x0a] : map.get(char)
      assert.ok(encoded, `no Shift_JIS bytes for ${char}`)
      bytes.push(...encoded)
    }
    return Uint8Array.from(bytes)
  }
})()

const SENTENCE = '甲は乙に対し、毎月末日までに報酬を支払うものとする。'

test('the Shift_JIS fixture really is Shift_JIS', () => {
  const bytes = toShiftJis(SENTENCE)
  assert.equal(new TextDecoder('shift_jis').decode(bytes), SENTENCE)
  assert.notEqual(new TextDecoder('utf-8').decode(bytes), SENTENCE, 'it must not be UTF-8')
})

test('charsetFromMeta reads what an HTML document says about itself', () => {
  const bytes = (html: string) => new TextEncoder().encode(html)
  assert.equal(charsetFromMeta(bytes('<meta charset="Shift_JIS">')), 'shift_jis')
  assert.equal(
    charsetFromMeta(bytes('<meta http-equiv="Content-Type" content="text/html; charset=EUC-JP">')),
    'euc-jp',
  )
  assert.equal(charsetFromMeta(bytes('<p>no declaration here</p>')), undefined)
})

test('a declared encoding is honoured, wherever it was declared', () => {
  const sentence = toShiftJis(SENTENCE)
  assert.equal(decodeBytes(sentence, 'x', { declared: 'shift_jis' }), SENTENCE)
  assert.equal(decodeBytes(sentence, 'x', { transport: 'text/plain; charset=Shift_JIS' }), SENTENCE)
  // A BOM outranks a declaration that disagrees with it.
  const bom = Uint8Array.from([0xef, 0xbb, 0xbf, ...new TextEncoder().encode('hello')])
  assert.equal(decodeBytes(bom, 'x', { declared: 'shift_jis' }), 'hello')
})

test('undeclared bytes that are not UTF-8 are refused, not mangled', () => {
  // Mojibake is the dangerous outcome: `detectLang` then reads it as English and
  // the whole run is spent on garbage in the wrong language.
  assert.throws(
    () => decodeBytes(toShiftJis(SENTENCE), 'notes.txt', {}),
    (error: unknown) =>
      error instanceof KamuError && /not valid UTF-8/.test((error as Error).message),
  )
  assert.equal(decodeBytes(new TextEncoder().encode('普通の UTF-8'), 'x', {}), '普通の UTF-8')
})

test('a page is ingested in the encoding it declares', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'kamu-encoding-'))
  const path = join(directory, 'page.html')
  await writeFile(path, toShiftJis(SJIS_HTML))

  const document = await ingest(path)
  assert.equal(document.lang, 'ja', 'mojibake would have been detected as English')
  assert.ok(document.text.includes(SENTENCE), document.text.slice(0, 40))
})

test('a source can carry the encoding its bytes do not declare', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'kamu-encoding-'))
  const path = join(directory, 'notes.txt')
  await writeFile(path, toShiftJis(SENTENCE))

  await assert.rejects(
    () => ingest(path),
    (error: unknown) => error instanceof KamuError,
  )

  const named = await ingest({ path, encoding: 'shift_jis' })
  assert.equal(named.lang, 'ja')
  assert.ok(named.text.includes(SENTENCE))

  const viaOptions = await ingest(path, { encoding: 'shift_jis' })
  assert.ok(viaOptions.text.includes(SENTENCE))
})

test('a fetched page is decoded by its Content-Type, not assumed UTF-8', async () => {
  const bytes = toShiftJis(SJIS_HTML)
  const serve = (contentType: string) =>
    (async () =>
      new Response(bytes, {
        status: 200,
        headers: { 'content-type': contentType },
      })) as unknown as typeof fetch

  for (const contentType of ['text/html; charset=Shift_JIS', 'text/html']) {
    const document = await ingest('https://example.jp/page', { fetchImpl: serve(contentType) })
    assert.equal(document.lang, 'ja', contentType)
    assert.ok(document.text.includes(SENTENCE), contentType)
  }
})
