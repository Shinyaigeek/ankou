import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  chew,
  chewPlan,
  FORMAT_IDS,
  FORMATS,
  isPiece,
  KamuError,
  plan as makePlan,
  pieceProblems,
  RENDERERS,
  render,
  renderTuiText,
  validate,
} from '../dist/index.js'

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

test('chewPlan decides the shape without composing it', async () => {
  const llm = stubLlm()
  const asked: string[] = []
  const spy = {
    ...llm,
    structured<T>(request: any): Promise<T> {
      asked.push(request.name)
      return llm.structured<T>(request)
    },
  }

  const { plan, documents } = await chewPlan({
    sources: [{ content: SOURCE, name: 'contract.md' }],
    intent: '要点だけ知りたい',
    llm: spy as never,
  })

  assert.equal(plan.format, 'summary')
  assert.equal(documents[0]?.title, '契約書の第一条')
  // Composing is what costs; asking what kamu *would* make must not pay for it.
  assert.deepEqual(asked, ['reading_plan'])
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

test('quiz questions come out gradeable however the model labelled them', async () => {
  const llm = stubLlm()
  const sloppy = {
    ...llm,
    async structured<T>(request: any): Promise<T> {
      if (request.name !== 'quiz') return llm.structured<T>(request)
      return {
        questions: [
          {
            // No ids at all, and the answer given as the choice text.
            kind: 'single',
            prompt: '報酬の支払期限は？',
            choices: [
              { id: '', text: '毎月末日' },
              { id: '', text: '毎月十日' },
            ],
            answer: ['毎月末日'],
            explanation: '第一条。',
            difficulty: 1,
          },
          {
            // A single-choice question the model marked every way at once.
            kind: 'single',
            prompt: '不可抗力は？',
            choices: [
              { id: 'x', text: '免責される' },
              { id: 'y', text: '免責されない' },
            ],
            answer: ['x', 'y'],
            explanation: '第二条。',
            difficulty: 2,
          },
          {
            // An answer that points at nothing: ungradeable, so it goes.
            kind: 'single',
            prompt: '有効期間は？',
            choices: [{ id: 'a', text: '一年間' }],
            answer: ['z'],
            explanation: '第三条。',
            difficulty: 1,
          },
        ],
      } as T
    },
  }

  const { piece } = await chew({
    sources: [{ content: SOURCE }],
    intent: '覚えたい',
    format: 'quiz',
    llm: sloppy as never,
  })
  assert.equal(piece.format, 'quiz')
  if (piece.format !== 'quiz') return

  assert.equal(piece.questions.length, 2, 'the ungradeable question should be dropped')
  for (const question of piece.questions) {
    const ids = new Set((question.choices ?? []).map((choice) => choice.id))
    assert.ok(question.answer.length > 0)
    for (const answer of question.answer) {
      assert.ok(ids.has(answer), `${question.prompt}: answer ${answer} is not a choice`)
    }
    if (question.kind === 'single') assert.equal(question.answer.length, 1)
  }
  // The answer was given as choice text; whichever slot the shuffle put it in,
  // it has to still be that choice.
  const first = piece.questions[0]
  assert.equal(first?.choices?.find((choice) => choice.id === first.answer[0])?.text, '毎月末日')
})

test('dialogue turns land on a real speaker even when the model drifts', async () => {
  const llm = stubLlm()
  const drifting = {
    ...llm,
    async structured<T>(request: any): Promise<T> {
      if (request.name !== 'dialogue') return llm.structured<T>(request)
      return {
        title: '契約書を読む',
        speakers: [
          { id: 'sensei', name: '先生', role: '契約に詳しい' },
          { id: 'seito', name: '生徒', role: '初めて読む' },
        ],
        turns: [
          { speaker: 'seito', text: '第二条は何を言っているんですか？' },
          { speaker: '先生', text: '注意義務の水準です。' }, // the name, not the id
          { speaker: 'ナレーター', text: 'そこで二人は黙った。' }, // nobody at all
          { speaker: 'SENSEI', text: '続けましょう。' }, // the right id, shouting
        ],
      } as T
    },
  }

  const { piece } = await chew({
    sources: [{ content: SOURCE }],
    intent: '解説してほしい',
    format: 'dialogue',
    llm: drifting as never,
  })
  assert.equal(piece.format, 'dialogue')
  if (piece.format !== 'dialogue') return

  const ids = new Set(piece.speakers.map((speaker) => speaker.id))
  for (const turn of piece.turns) assert.ok(ids.has(turn.speaker), `stray speaker ${turn.speaker}`)
  assert.deepEqual(
    piece.turns.map((turn) => turn.speaker),
    // The name and the shouted id resolve; only the invented one falls back,
    // and it falls back to whoever did not just speak.
    ['seito', 'sensei', 'seito', 'sensei'],
  )
})

test('a format refuses to hand back an empty piece', async () => {
  // What an exhausted model looks like: every schema satisfied, nothing in it.
  const empty: Record<string, unknown> = {
    reading_plan: { format: 'summary', rationale: '', params: {} },
    slide_deck: { title: '', slides: [] },
    quiz: { questions: [] },
    animation: { title: '', scenes: [] },
    summary_part: { sectionTitle: '', summary: '', points: [], terms: [] },
    summary: { title: '', tldr: '   ', keyPoints: [], openQuestions: [] },
    dialogue: {
      title: '',
      speakers: [
        { id: 'a', name: 'A', role: 'r' },
        { id: 'b', name: 'B', role: 'r' },
      ],
      turns: [],
    },
    flipbook_annotations: {
      title: '',
      chapterTitles: [],
      emphasis: [],
      ruby: [],
      pacing: { baseMs: 60 },
    },
  }
  const exhausted = {
    name: 'stub:empty',
    async complete() {
      return '{}'
    },
    async structured<T>(request: any): Promise<T> {
      assert.ok(request.name in empty, `no empty answer for ${request.name}`)
      return empty[request.name] as T
    },
  }

  for (const format of FORMAT_IDS) {
    // Flipbook's body is the source, not the model, so starve it of the source.
    const sources = format === 'flipbook' ? [{ content: '   \n\n  ' }] : [{ content: SOURCE }]
    await assert.rejects(
      () => chew({ sources, intent: 'x', format, llm: exhausted as never }),
      (error: unknown) => error instanceof KamuError,
      `${format} rendered an empty piece instead of failing`,
    )
  }
})

test('a piece survives a round trip through JSON and renders again', async () => {
  // The claim the whole Piece boundary exists to make: one model call, many
  // surfaces, including surfaces chosen long after the model has gone home.
  for (const format of FORMAT_IDS) {
    const { piece } = await chew({
      sources: [{ content: SOURCE, name: 'contract.md' }],
      intent: 'ちゃんと読みたい',
      format,
      llm: stubLlm() as never,
    })

    const stored = render(piece, 'json').content
    const restored: unknown = JSON.parse(stored)
    assert.ok(isPiece(restored), `${format} did not survive the round trip`)

    assert.equal(render(restored, 'html').content, render(piece, 'html').content)
    assert.equal(render(restored, 'json').content, stored)
  }
})

test('isPiece rejects a piece the renderers could not render', () => {
  assert.equal(isPiece(null), false)
  assert.equal(isPiece('slides'), false)
  assert.equal(isPiece({}), false)
  assert.equal(isPiece({ format: 'poster' }), false, 'an unknown format is not a piece')

  // The discriminant alone was the whole check, and it let through pieces that
  // reached the renderers and threw a bare TypeError at the reader.
  assert.equal(isPiece({ format: 'slides', title: 'T', lang: 'en' }), false)
  assert.deepEqual(pieceProblems({ format: 'slides', title: 'T', lang: 'en' }), [
    'meta.sources',
    'slides',
  ])
  assert.deepEqual(pieceProblems({ format: 'quiz' }), [
    'title',
    'lang',
    'meta.sources',
    'questions',
  ])
})

test('every piece kamu composes passes its own check, and then renders', async () => {
  for (const format of FORMAT_IDS) {
    const { piece } = await chew({
      sources: [{ content: SOURCE }],
      intent: 'x',
      format,
      llm: stubLlm() as never,
    })
    assert.deepEqual(pieceProblems(piece), [], `${format} fails the check it should pass`)
    // The check exists to promise this, so the promise is what gets tested.
    for (const renderer of RENDERERS) {
      assert.doesNotThrow(() => render(piece, renderer), `${format} → ${renderer}`)
    }
  }
})

test('the deck answers a hash that arrives after it has loaded', async () => {
  const { piece } = await chew({
    sources: [{ content: SOURCE }],
    intent: 'x',
    format: 'slides',
    llm: stubLlm() as never,
  })
  const html = render(piece, 'html').content
  // A slide number in the URL is an address; it has to work when someone pastes
  // one into a deck that is already open, not only on a cold load.
  assert.match(html, /addEventListener\('hashchange'/)
})

test('every knob a format declares is one the planner is allowed to set', async () => {
  // A provider's grammar drops any property the schema does not declare, and
  // says nothing about it. So a knob the menu advertises but the schema omits is
  // a knob the planner can ask for and never receive — silently, forever.
  let planSchema: any
  const capture = {
    ...stubLlm(),
    async structured<T>(request: any): Promise<T> {
      if (request.name === 'reading_plan') planSchema = request.schema
      return stubLlm().structured<T>(request)
    },
  }
  await chew({ sources: [{ content: SOURCE }], intent: '要点', llm: capture as never })

  const allowed = planSchema.properties.params.properties
  for (const id of FORMAT_IDS) {
    for (const [key, knob] of Object.entries(FORMATS[id].params)) {
      assert.ok(allowed[key], `${id} advertises \`${key}\` but the planner cannot set it`)
      assert.equal(allowed[key].type, knob.type, `${id}.${key}: type disagrees with the schema`)
    }
  }
})

test('the flipbook carries its whole text into the page, not just the stage', async () => {
  const { piece } = await chew({
    sources: [{ content: SOURCE, name: 'contract.md' }],
    intent: '一字一句読みたい',
    format: 'flipbook',
    llm: stubLlm() as never,
  })
  const html = render(piece, 'html').content

  // The stage shows one character; everything else lives in the data island and
  // is materialised into `.fb-print` before printing. Both halves have to exist
  // or the page prints a single letter.
  assert.match(html, /class="fb-print"/, 'no printable copy to fill')
  assert.match(html, /@media print[\s\S]*\.fb-print \{ display: block/, 'never shown in print')
  assert.match(html, /addEventListener\('beforeprint'/, 'nothing fills it')
  assert.match(
    html,
    /requestIdleCallback|setTimeout\(fillForPrint/,
    'a headless print fires no event',
  )
  // The regex that splits paragraphs has to survive being written inside a
  // template literal — a bare newline there is a syntax error on the page.
  assert.ok(html.includes(String.raw`split(/\n{2,}/)`), 'the paragraph split did not survive')
})

test('the animation puts every scene on paper, since paper cannot move', async () => {
  const { piece } = await chew({
    sources: [{ content: SOURCE }],
    intent: 'make it land',
    format: 'animation',
    llm: stubLlm() as never,
  })
  const html = render(piece, 'html').content

  assert.match(html, /class="an-print"/, 'no printable copy to fill')
  assert.match(html, /@media print[\s\S]*\.an-print \{ display: block/, 'never shown in print')
  assert.match(html, /addEventListener\('beforeprint'/, 'nothing fills it')
  assert.match(
    html,
    /requestIdleCallback|setTimeout\(fillForPrint/,
    'a headless print fires no event',
  )
})

test('the planner is shown an outline, not an author list', async () => {
  // A PDF has no headings, only lines that look like them, so a paper's inferred
  // structure runs to hundreds: every author, affiliation and email became a
  // heading, and the planner saw twelve email addresses where the outline goes.
  const noise = Array.from({ length: 40 }, (_, i) => ({
    level: 1,
    title: `author${i}@example.com`,
    text: '',
  }))
  const real = [
    { level: 1, title: 'Abstract', text: 'x'.repeat(400) },
    { level: 1, title: '1 Introduction', text: 'y'.repeat(400) },
  ]
  const document = {
    id: 'd',
    title: 'A Paper',
    origin: { kind: 'pdf' as const, ref: 'paper.pdf' },
    text: 'body',
    sections: [...real.slice(0, 1), ...noise, ...real.slice(1)],
    meta: {},
    charCount: 4,
    lang: 'en',
  }

  let prompt = ''
  const spy = {
    name: 'spy',
    async complete() {
      return '{}'
    },
    async structured<T>(request: any): Promise<T> {
      prompt = request.prompt
      return { format: 'summary', rationale: '', params: {} } as T
    },
  }
  await makePlan([document], 'what does this say', spy as never)

  const outline = prompt.slice(prompt.indexOf('Outline:'))
  assert.ok(outline.includes('- Abstract'), 'the real headings went missing')
  assert.ok(outline.includes('- 1 Introduction'))
  assert.ok(!outline.includes('@example.com'), 'the author list is still the outline')
})

test('the theme is settled in the head, before anything is painted', async () => {
  const { piece } = await chew({
    sources: [{ content: SOURCE }],
    intent: 'x',
    format: 'summary',
    llm: stubLlm() as never,
  })
  const html = render(piece, 'html').content
  const head = html.slice(0, html.indexOf('</head>'))

  // At the end of <body> this arrived after the browser had already painted a
  // screenful in the system theme: measured on a 190KB page, a dark frame at
  // 1951 nodes and the reader's stored light theme at 2489.
  assert.ok(head.includes('kamu-theme'), 'the stored theme is read too late to matter')
  assert.ok(
    head.includes('kamuToggleTheme'),
    'the toggle is defined after the button that calls it',
  )
  assert.ok(
    html.indexOf('kamu-theme') < html.indexOf('<body>'),
    'the theme script is below the body',
  )
})
