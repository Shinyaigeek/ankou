import assert from 'node:assert/strict'
import { test } from 'node:test'
import { chew, FORMAT_IDS, render, renderTuiText, validate } from '../dist/index.js'

const SOURCE = `# 契約書の第一条

本契約は、甲と乙の間で締結される。甲は乙に対し、毎月末日までに報酬を支払うものとする。

## 第二条

乙は、善良な管理者の注意をもって業務を遂行する。天災その他の不可抗力による遅延については、この限りではない。

## 第三条

本契約の有効期間は、締結日から一年間とする。`

/**
 * A stub model that answers every schema kamu asks for. It lets the whole
 * pipeline run in tests without a network call, and it doubles as a check that
 * each format survives a model that gives the bare minimum.
 */
function stubLlm(): {
  name: string
  complete(): Promise<string>
  structured<T>(request: any): Promise<T>
} {
  const answers: Record<string, unknown> = {
    reading_plan: { format: 'summary', rationale: 'テスト用', params: {} },
    flipbook_annotations: {
      title: '契約書',
      chapterTitles: ['第一条', '第二条', '第三条', '第四条'],
      emphasis: [{ term: '不可抗力', gloss: 'force majeure', weight: 3 }],
      ruby: [{ term: '善良', reading: 'ぜんりょう' }],
      pacing: { baseMs: 60, note: 'dense legal prose' },
    },
    slide_deck: {
      title: '契約書の要点',
      slides: [
        { title: '報酬は月末払い', bullets: ['甲が乙に支払う'], notes: 'note' },
        {
          title: '不可抗力は免責',
          bullets: ['天災による遅延は対象外'],
          visual: { type: 'quote', text: 'この限りではない', attribution: '第二条' },
        },
      ],
    },
    quiz: {
      questions: [
        {
          kind: 'single',
          prompt: '報酬の支払期限は？',
          choices: [
            { id: 'a', text: '毎月末日' },
            { id: 'b', text: '毎月十日' },
          ],
          answer: ['a'],
          explanation: '第一条に定めがある。',
          evidence: '毎月末日までに報酬を支払う',
          difficulty: 1,
        },
      ],
    },
    animation: {
      title: '契約書',
      scenes: [
        {
          lines: [{ text: '毎月末日', scale: 'xl', accent: 'true' }],
          motion: 'zoom',
          durationMs: 600,
          holdMs: 1200,
          mood: 'tense',
        },
      ],
    },
    summary_part: {
      sectionTitle: '第一条から第三条',
      summary: '報酬、注意義務、期間の三点を定める。',
      points: ['報酬は月末払い', '不可抗力は免責'],
      terms: [{ term: '不可抗力', definition: '天災など当事者に責のない事由。' }],
    },
    summary: {
      title: '契約書の要点',
      tldr: '三条からなる短い契約。',
      keyPoints: [{ text: '報酬は月末払い', detail: '第一条' }],
      openQuestions: [],
    },
    dialogue: {
      title: '契約書を読む',
      speakers: [
        { id: 'sensei', name: '先生', role: '契約に詳しい' },
        { id: 'seito', name: '生徒', role: '初めて読む' },
      ],
      turns: [
        { speaker: 'seito', text: '第二条って何が言いたいんですか？' },
        { speaker: 'sensei', text: '注意義務の水準を定めています。' },
      ],
    },
  }

  return {
    name: 'stub:test',
    async complete() {
      return '{}'
    },
    async structured<T>(request: any): Promise<T> {
      const answer = answers[request.name]
      assert.ok(answer, `stub has no answer for ${request.name}`)
      const errors = validate(answer, request.schema)
      assert.deepEqual(
        errors,
        [],
        `stub answer for ${request.name} fails its own schema: ${errors.join('; ')}`,
      )
      return answer as T
    },
  }
}

test('every format composes and renders through all renderers', async () => {
  for (const format of FORMAT_IDS) {
    const { piece, plan } = await chew({
      sources: [{ content: SOURCE, name: 'contract.md' }],
      intent: 'ちゃんと読みたい',
      format,
      llm: stubLlm() as never,
    })

    assert.equal(piece.format, format)
    assert.equal(plan.format, format)
    assert.equal(piece.lang, 'ja')
    assert.ok(piece.title.length > 0)
    assert.equal(piece.meta.sources[0]?.title, '契約書の第一条')

    const html = render(piece, 'html').content
    assert.ok(html.startsWith('<!doctype html>'), `${format} html`)
    assert.ok(html.includes('</html>'))
    assert.ok(!html.includes('undefined</'), `${format} html leaked an undefined`)

    const json = JSON.parse(render(piece, 'json').content)
    assert.equal(json.format, format)

    const tui = renderTuiText(piece, { columns: 60, colour: false })
    assert.ok(tui.includes('chewed by kamu'))
  }
})

test('flipbook reproduces the source verbatim', async () => {
  const { piece } = await chew({
    sources: [{ content: SOURCE, name: 'contract.md' }],
    intent: '一字一句読みたい',
    format: 'flipbook',
    llm: stubLlm() as never,
  })
  assert.equal(piece.format, 'flipbook')
  if (piece.format !== 'flipbook') return

  const played = piece.chapters.map((chapter) => chapter.text).join('')
  // Every sentence of the source has to survive into the flipbook untouched.
  for (const sentence of [
    '甲は乙に対し、毎月末日までに報酬を支払うものとする。',
    '本契約の有効期間は、締結日から一年間とする。',
  ]) {
    assert.ok(played.includes(sentence), `lost: ${sentence}`)
  }
  assert.ok(piece.pacing.punctuationMs > piece.pacing.baseMs)
})

test('the planner is skipped when a format is given', async () => {
  const llm = stubLlm()
  let planned = false
  const spy = {
    ...llm,
    structured<T>(request: any): Promise<T> {
      if (request.name === 'reading_plan') planned = true
      return llm.structured<T>(request)
    },
  }
  await chew({
    sources: [{ content: SOURCE }],
    intent: 'x',
    format: 'quiz',
    llm: spy as never,
  })
  assert.equal(planned, false)
})

test('the planner runs and its choice is used when no format is given', async () => {
  const { piece, plan } = await chew({
    sources: [{ content: SOURCE }],
    intent: '要点だけ知りたい',
    llm: stubLlm() as never,
  })
  assert.equal(plan.format, 'summary')
  assert.equal(piece.format, 'summary')
  assert.equal(plan.rationale, 'テスト用')
})

test('html output escapes markup coming from the source', async () => {
  const { piece } = await chew({
    sources: [
      { content: '<script>alert(1)</script> plain words here', name: 'x.txt', kind: 'text' },
    ],
    intent: 'read it',
    format: 'flipbook',
    llm: stubLlm() as never,
  })
  const html = render(piece, 'html').content
  const body = html.slice(html.indexOf('<body>'))
  assert.ok(!body.includes('<script>alert(1)</script>'))
})

test('the output language follows the intent when the intent has one', async () => {
  const english = 'The quick brown fox jumps over the lazy dog. '.repeat(20)

  // Japanese intent over an English source: the reader asked in Japanese.
  const ja = await chew({
    sources: [{ content: english, kind: 'text' }],
    intent: '覚えたいのでテストして',
    format: 'quiz',
    llm: stubLlm() as never,
  })
  assert.equal(ja.piece.lang, 'ja')

  // An English-looking intent carries no signal, so the source decides.
  const inherited = await chew({
    sources: [{ content: SOURCE, name: 'contract.md' }],
    intent: 'quiz me',
    format: 'quiz',
    llm: stubLlm() as never,
  })
  assert.equal(inherited.piece.lang, 'ja')
})
