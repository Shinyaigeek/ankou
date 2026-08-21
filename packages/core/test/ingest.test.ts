import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ingest, kindFromContent, kindFromMime, looksLikeUrl } from '../dist/index.js'
import { documentFromHtml } from '../dist/ingest/html.js'
import { splitMarkdownSections } from '../dist/ingest/markdown.js'
import { reflowPdfText } from '../dist/ingest/pdf.js'

test('kindFromContent sniffs html, markdown and plain text', () => {
  assert.equal(kindFromContent('<!doctype html><html><body>hi</body></html>'), 'html')
  assert.equal(kindFromContent('# Title\n\nsome prose'), 'markdown')
  assert.equal(kindFromContent('just some words here'), 'text')
})

test('kindFromMime maps content types', () => {
  assert.equal(kindFromMime('application/pdf'), 'pdf')
  assert.equal(kindFromMime('text/html; charset=utf-8'), 'html')
  assert.equal(kindFromMime('text/plain'), 'text')
  assert.equal(kindFromMime('image/png'), undefined)
})

test('looksLikeUrl only matches http(s)', () => {
  assert.equal(looksLikeUrl('https://example.com'), true)
  assert.equal(looksLikeUrl('./local.md'), false)
})

test('markdown sections split on headings but not inside fences', () => {
  const sections = splitMarkdownSections('# A\n\ntext\n\n```\n# not a heading\n```\n\n## B\n\nmore')
  assert.deepEqual(
    sections.map((section) => section.title),
    ['A', 'B'],
  )
})

test('html ingestion extracts the article and drops the chrome', () => {
  const html = `<!doctype html><html lang="en"><head><title>Post</title>
    <meta property="og:title" content="The Real Title"></head>
    <body>
      <nav><a href="/">Home</a><a href="/about">About</a><a href="/x">X</a></nav>
      <article><h1>Heading</h1>
        <p>${'This is the actual body of the article, with real prose in it. '.repeat(6)}</p>
        <p>A second paragraph that carries more of the argument forward, at length.</p>
      </article>
      <footer>copyright nobody</footer>
    </body></html>`
  const document = documentFromHtml(html, 'test.html')
  assert.equal(document.title, 'The Real Title')
  assert.equal(document.lang, 'en')
  assert.ok(document.text.includes('actual body of the article'))
  assert.ok(!document.text.includes('copyright nobody'))
  assert.ok(!document.text.includes('About'))
})

test('html ingestion decodes entities and keeps code blocks', () => {
  const document = documentFromHtml(
    `<body><main><p>${'padding sentence for scoring. '.repeat(10)}</p><p>a &amp; b &lt;c&gt; &#65;</p><pre><code>x = 1</code></pre></main></body>`,
    'test.html',
  )
  assert.ok(document.text.includes('a & b <c> A'))
  assert.ok(document.text.includes('x = 1'))
})

test('pdf reflow joins wrapped lines and keeps paragraph breaks', () => {
  const page =
    'A Heading\nthis sentence was broken\nacross two typeset lines.\n\nnext block starts here.'
  const reflowed = reflowPdfText(page)
  assert.ok(reflowed.includes('this sentence was broken across two typeset lines.'))
  assert.ok(reflowed.startsWith('A Heading'))
})

test('inline content ingests without touching the filesystem', async () => {
  const document = await ingest({ content: '# Hello\n\nworld', name: 'inline.md' })
  assert.equal(document.title, 'Hello')
  assert.equal(document.origin.kind, 'markdown')
})

test('the parser survives markup inside an attribute value', () => {
  // Wikipedia ships JSON blobs containing ">" in data-mw; a naive scan for the
  // next ">" cuts the tag in half and spills the attribute into the page.
  const html = `<body><main>
    <span class="x" data-mw='{"wt":"<ref>{{cite|url=http://a/b}}</ref>"}'></span>
    <p>${'Real prose that should be the extracted body of this page. '.repeat(8)}</p>
  </main></body>`
  const document = documentFromHtml(html, 'test.html')
  assert.ok(document.text.includes('Real prose'))
  assert.ok(!document.text.includes('cite'))
})

test('hidden and boilerplate containers are pruned', () => {
  const html = `<body><main>
    <p>${'The article itself, long enough to win the scoring pass. '.repeat(8)}</p>
    <div class="mw-normal-catlinks">Categories: one two three</div>
    <div style="display:none">invisible text</div>
    <div aria-hidden="true">also invisible</div>
  </main></body>`
  const document = documentFromHtml(html, 'test.html')
  assert.ok(document.text.includes('The article itself'))
  for (const junk of ['Categories:', 'invisible text', 'also invisible']) {
    assert.ok(!document.text.includes(junk), `kept ${junk}`)
  }
})

test('a meta refresh is followed once', async () => {
  const pages: Record<string, string> = {
    'https://example.com/old':
      '<html><head><meta http-equiv="refresh" content="0; url=/new"></head><body>go</body></html>',
    'https://example.com/new': `<html><body><main><p>${'The page you actually wanted, at length. '.repeat(10)}</p></main></body></html>`,
  }
  const document = await ingest('https://example.com/old', {
    fetchImpl: async (input) =>
      new Response(pages[String(input)] ?? '', {
        status: pages[String(input)] ? 200 : 404,
        headers: { 'content-type': 'text/html' },
      }) as never,
  })
  assert.equal(document.origin.ref, 'https://example.com/new')
  assert.ok(document.text.includes('actually wanted'))
})

test('a client-rendered shell is reported instead of chewed', async () => {
  const shell = `<html><head><title>App</title></head><body><div id="root">loading</div>${'<script>var x=1;</script>'.repeat(200)}</body></html>`
  await assert.rejects(
    () =>
      ingest('https://example.com/spa', {
        fetchImpl: async () =>
          new Response(shell, { status: 200, headers: { 'content-type': 'text/html' } }) as never,
      }),
    /renders its content with JavaScript|characters of text/,
  )
})
