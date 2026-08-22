import type { AnimationPiece, FlipbookPiece, Piece, QuizPiece, SlidesPiece } from '../../types.js'
import { graphemes } from '../../util/text.js'
import { ansi, centre, paint, palette, rule, screen, supportsColour, wrap } from './term.js'
import { renderTuiText } from './text.js'

export interface PlayOptions {
  input?: NodeJS.ReadStream
  output?: NodeJS.WriteStream
  colour?: boolean
  signal?: AbortSignal
}

type Key =
  | { name: 'char'; value: string }
  | { name: 'up' | 'down' | 'left' | 'right' | 'enter' | 'escape' | 'backspace' | 'quit' }

/** Minimal key decoder: enough for arrows, Enter, Escape and printable input. */
const CTRL_C = '\u0003'
const CTRL_D = '\u0004'
const ESCAPE = '\u001b'
const DELETE = '\u007f'

function decode(chunk: string): Key[] {
  const keys: Key[] = []
  let index = 0
  while (index < chunk.length) {
    const char = chunk[index]!
    if (char === CTRL_C || char === CTRL_D) {
      keys.push({ name: 'quit' })
      index += 1
    } else if (char === ESCAPE && chunk[index + 1] === '[') {
      const code = chunk[index + 2]
      const map: Record<string, 'up' | 'down' | 'left' | 'right'> = {
        A: 'up',
        B: 'down',
        C: 'right',
        D: 'left',
      }
      const name = code ? map[code] : undefined
      if (name) keys.push({ name })
      index += 3
    } else if (char === ESCAPE) {
      keys.push({ name: 'escape' })
      index += 1
    } else if (char === '\r' || char === '\n') {
      keys.push({ name: 'enter' })
      index += 1
    } else if (char === DELETE || char === '\b') {
      keys.push({ name: 'backspace' })
      index += 1
    } else {
      keys.push({ name: 'char', value: char })
      index += 1
    }
  }
  return keys
}

interface Session {
  columns: number
  rows: number
  colour: boolean
  write(frame: string[]): void
  onKey(handler: (key: Key) => void): void
  wait(): Promise<void>
  end(): void
  paint(text: string, ...codes: string[]): string
}

function startSession(options: PlayOptions): Session {
  const input = options.input ?? process.stdin
  const output = options.output ?? process.stdout
  const colour = options.colour ?? supportsColour(output)
  let handler: (key: Key) => void = () => {}
  let finish: () => void = () => {}
  let ended = false

  const done = new Promise<void>((resolve) => {
    finish = resolve
  })

  const onData = (data: Buffer | string) => {
    for (const key of decode(data.toString('utf8'))) {
      if (key.name === 'quit') return end()
      handler(key)
    }
  }

  // Named so they can be taken off again: a session that ends normally must
  // leave the process exactly as it found it, or an SDK caller playing a
  // hundred pieces collects a hundred SIGINT handlers and Node's listener
  // warning.
  const onSigint = () => end()
  const onAbort = () => end()

  const end = () => {
    if (ended) return
    ended = true
    input.off('data', onData)
    process.off('SIGINT', onSigint)
    options.signal?.removeEventListener('abort', onAbort)
    if (input.isTTY) input.setRawMode(false)
    input.pause()
    output.write(screen.exit)
    finish()
  }

  if (input.isTTY) input.setRawMode(true)
  input.resume()
  input.setEncoding('utf8')
  input.on('data', onData)
  output.write(screen.enter)
  process.once('SIGINT', onSigint)
  options.signal?.addEventListener('abort', onAbort, { once: true })

  const session: Session = {
    get columns() {
      return Math.max(30, Math.min(output.columns ?? 80, 120))
    },
    get rows() {
      return Math.max(10, output.rows ?? 24)
    },
    colour,
    write(frame) {
      if (ended) return
      output.write(screen.clear + frame.join('\n'))
    },
    onKey(next) {
      handler = next
    },
    wait: () => done,
    end,
    paint: (text, ...codes) => (colour ? paint(text, ...codes) : text),
  }
  return session
}

/** Pad a frame to the full screen height so the alternate buffer looks stable. */
function frame(session: Session, header: string[], body: string[], footer: string[]): string[] {
  const space = Math.max(0, session.rows - header.length - footer.length - 1)
  const visible = body.slice(0, space)
  const filler = new Array(Math.max(0, space - visible.length)).fill('')
  return [...header, ...visible, ...filler, ...footer]
}

function footerHints(session: Session, hints: [string, string][]): string[] {
  const text = hints
    .map(([key, label]) => `${session.paint(key, palette.accent)} ${label}`)
    .join('   ')
  return [session.paint(rule(session.columns), palette.faint), text]
}

// --- flipbook ---------------------------------------------------------------

async function playFlipbook(piece: FlipbookPiece, session: Session): Promise<void> {
  const tape: { char: string; chapter: number; weight: number }[] = []
  const starts: number[] = []
  const weightOf = new Map<string, number>()
  for (const item of piece.emphasis) weightOf.set(item.term, item.weight)

  piece.chapters.forEach((chapter, index) => {
    starts.push(tape.length)
    const chars = graphemes(chapter.text)
    const weights = new Array<number>(chars.length).fill(0)
    for (const [term, weight] of weightOf) {
      // `indexOf('')` answers `from` forever, so an empty term is not a term
      // it is a hang — and a piece can arrive from anywhere, not just from
      // kamu's own composer. The browser renderer has always guarded this.
      if (!term) continue
      let from = 0
      for (;;) {
        const at = chapter.text.indexOf(term, from)
        if (at < 0) break
        let offset = 0
        for (let i = 0; i < chars.length; i++) {
          if (offset >= at && offset < at + term.length) weights[i] = Math.max(weights[i]!, weight)
          offset += chars[i]!.length
        }
        from = at + term.length
      }
    }
    chars.forEach((char, i) => {
      tape.push({ char, chapter: index, weight: weights[i]! })
    })
  })

  let at = 0
  let playing = true
  let rate = 1
  let timer: NodeJS.Timeout | null = null

  const delay = (char: string, weight: number) => {
    const base = piece.pacing.baseMs / rate
    if (char === '\n') return piece.pacing.paragraphMs / rate
    if (/[。．.!！?？]/.test(char)) return piece.pacing.punctuationMs / rate
    if (/[、,，;；:：]/.test(char)) return (piece.pacing.punctuationMs * 0.55) / rate
    if (char === ' ') return base * 0.5
    return weight >= 2 ? base * 1.6 : base
  }

  const draw = () => {
    const unit = tape[at]
    if (!unit) return
    const columns = session.columns - 4
    const chapterStart = starts[unit.chapter] ?? 0
    const revealed = tape
      .slice(chapterStart, at + 1)
      .map((cell) => cell.char)
      .join('')
    const lines = wrap(revealed, columns)
    const cursorLine = lines.length - 1
    const window = Math.max(3, session.rows - 8)
    const visible = lines.slice(Math.max(0, cursorLine - window + 1), cursorLine + 1)

    // Mark the character that just landed so the eye has something to follow.
    if (visible.length > 0) {
      const last = visible[visible.length - 1]!
      const head = last.slice(0, last.length - unit.char.length)
      const codes = unit.weight >= 2 ? [ansi.bold, palette.accent] : [ansi.inverse]
      visible[visible.length - 1] = head + session.paint(unit.char, ...codes)
    }

    const percent = Math.round(((at + 1) / tape.length) * 100)
    const header = [
      session.paint(
        ` ${piece.title}  ${session.paint(
          piece.chapters[unit.chapter]?.title ?? '',
          palette.muted,
        )}`,
        ansi.bold,
      ),
      session.paint(
        ` ${at + 1}/${tape.length}  ${percent}%  ${rate.toFixed(2)}x  ${playing ? 'playing' : 'paused'}`,
        palette.faint,
      ),
      '',
    ]
    session.write(
      frame(
        session,
        header,
        visible.map((line) => `  ${line}`),
        footerHints(session, [
          ['space', playing ? 'pause' : 'play'],
          ['←→', 'step'],
          ['↑↓', 'speed'],
          ['[ ]', 'chapter'],
          ['q', 'quit'],
        ]),
      ),
    )
  }

  const tick = () => {
    draw()
    if (!playing) return
    const unit = tape[at]
    if (!unit) return
    timer = setTimeout(
      () => {
        if (at + 1 >= tape.length) {
          playing = false
          draw()
          return
        }
        at += 1
        tick()
      },
      delay(unit.char, unit.weight),
    )
  }

  const stop = () => {
    playing = false
    if (timer) clearTimeout(timer)
  }

  session.onKey((key) => {
    if (key.name === 'char' && key.value === ' ') {
      if (playing) {
        stop()
        draw()
      } else {
        playing = true
        tick()
      }
      return
    }
    if (key.name === 'right' || key.name === 'left') {
      stop()
      at = Math.max(0, Math.min(tape.length - 1, at + (key.name === 'right' ? 1 : -1)))
      draw()
      return
    }
    if (key.name === 'up' || key.name === 'down') {
      rate = Math.max(0.15, Math.min(8, rate * (key.name === 'up' ? 1.25 : 0.8)))
      draw()
      return
    }
    if (key.name === 'char' && (key.value === '[' || key.value === ']')) {
      const chapter = (tape[at]?.chapter ?? 0) + (key.value === ']' ? 1 : -1)
      at = starts[Math.max(0, Math.min(starts.length - 1, chapter))] ?? 0
      draw()
      return
    }
    if (key.name === 'char' && key.value === 'q') {
      stop()
      session.end()
    }
  })

  tick()
  await session.wait()
  if (timer) clearTimeout(timer)
}

// --- paged formats ----------------------------------------------------------

interface Page {
  header: string[]
  body: string[]
}

function playPages(session: Session, pages: Page[], label: string): Promise<void> {
  let at = 0
  let scroll = 0

  const draw = () => {
    const page = pages[at]
    if (!page) return
    const height = Math.max(3, session.rows - page.header.length - 3)
    scroll = Math.max(0, Math.min(scroll, Math.max(0, page.body.length - height)))
    session.write(
      frame(
        session,
        page.header,
        page.body.slice(scroll, scroll + height),
        footerHints(session, [
          ['←→', label],
          ['↑↓', 'scroll'],
          ['q', 'quit'],
          [`${at + 1}/${pages.length}`, ''],
        ]),
      ),
    )
  }

  session.onKey((key) => {
    if (
      key.name === 'right' ||
      (key.name === 'char' && key.value === ' ') ||
      key.name === 'enter'
    ) {
      at = Math.min(pages.length - 1, at + 1)
      scroll = 0
    } else if (key.name === 'left') {
      at = Math.max(0, at - 1)
      scroll = 0
    } else if (key.name === 'down') {
      scroll += 1
    } else if (key.name === 'up') {
      scroll = Math.max(0, scroll - 1)
    } else if (key.name === 'char' && key.value === 'q') {
      return session.end()
    }
    draw()
  })

  draw()
  return session.wait()
}

function slidePages(piece: SlidesPiece, session: Session): Page[] {
  const columns = session.columns - 4
  return piece.slides.map((slide, index) => {
    const body: string[] = ['']
    for (const line of wrap(slide.title, columns)) body.push(`  ${session.paint(line, ansi.bold)}`)
    body.push('')
    for (const bullet of slide.bullets) {
      const lines = wrap(bullet, columns - 4)
      body.push(`   ${session.paint('•', palette.accent)} ${lines[0] ?? ''}`)
      for (const line of lines.slice(1)) body.push(`     ${line}`)
    }
    if (slide.visual?.type === 'quote') {
      body.push('')
      for (const line of wrap(`"${slide.visual.text}"`, columns - 4)) {
        body.push(`   ${session.paint(line, ansi.italic, palette.muted)}`)
      }
    }
    if (slide.visual?.type === 'stat') {
      body.push(
        '',
        `   ${session.paint(slide.visual.value, ansi.bold, palette.accent)}  ${slide.visual.caption}`,
      )
    }
    if (slide.visual?.type === 'code' || slide.visual?.type === 'mermaid') {
      body.push('')
      for (const line of slide.visual.code.split('\n')) {
        body.push(`   ${session.paint(line, palette.muted)}`)
      }
    }
    if (slide.notes) {
      body.push('', session.paint(rule(session.columns), palette.faint))
      for (const line of wrap(slide.notes, columns))
        body.push(`  ${session.paint(line, palette.faint)}`)
    }
    return {
      header: [
        session.paint(` ${piece.title}`, ansi.bold),
        session.paint(` slide ${index + 1} of ${piece.slides.length}`, palette.faint),
      ],
      body,
    }
  })
}

function transcriptPages(piece: Piece, session: Session): Page[] {
  const lines = renderTuiText(piece, { columns: session.columns - 2, colour: session.colour })
    .split('\n')
    .map((line) => ` ${line}`)
  const height = Math.max(6, session.rows - 5)
  const pages: Page[] = []
  for (let index = 0; index < lines.length; index += height) {
    pages.push({
      header: [session.paint(` ${piece.title}`, ansi.bold), ''],
      body: lines.slice(index, index + height),
    })
  }
  return pages.length > 0 ? pages : [{ header: [piece.title], body: [] }]
}

// --- animation --------------------------------------------------------------

async function playAnimation(piece: AnimationPiece, session: Session): Promise<void> {
  let at = 0
  let playing = true
  let timer: NodeJS.Timeout | null = null

  const draw = () => {
    const scene = piece.scenes[at]
    if (!scene) return
    const columns = session.columns - 4
    const body: string[] = []
    const padding = Math.max(0, Math.floor((session.rows - 8 - scene.lines.length * 2) / 2))
    for (let i = 0; i < padding; i++) body.push('')
    for (const line of scene.lines) {
      const codes = line.accent
        ? [ansi.bold, palette.accent]
        : line.scale === 'xl' || line.scale === 'lg'
          ? [ansi.bold]
          : []
      for (const wrapped of wrap(line.text, columns)) {
        body.push(session.paint(centre(wrapped, session.columns), ...codes))
      }
      body.push('')
    }
    session.write(
      frame(
        session,
        [session.paint(` ${piece.title}`, ansi.bold), ''],
        body,
        footerHints(session, [
          ['space', playing ? 'pause' : 'play'],
          ['←→', 'scene'],
          ['q', 'quit'],
          [`${at + 1}/${piece.scenes.length}`, ''],
        ]),
      ),
    )
  }

  const schedule = () => {
    if (timer) clearTimeout(timer)
    if (!playing) return
    const scene = piece.scenes[at]
    if (!scene) return
    timer = setTimeout(() => {
      if (at + 1 >= piece.scenes.length) {
        playing = false
        draw()
        return
      }
      at += 1
      draw()
      schedule()
    }, scene.durationMs + scene.holdMs)
  }

  session.onKey((key) => {
    if (key.name === 'char' && key.value === ' ') {
      playing = !playing
      schedule()
    } else if (key.name === 'right') {
      playing = false
      at = Math.min(piece.scenes.length - 1, at + 1)
    } else if (key.name === 'left') {
      playing = false
      at = Math.max(0, at - 1)
    } else if (key.name === 'char' && key.value === 'q') {
      if (timer) clearTimeout(timer)
      return session.end()
    }
    draw()
  })

  draw()
  schedule()
  await session.wait()
  if (timer) clearTimeout(timer)
}

// --- quiz -------------------------------------------------------------------

function normalise(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[\s\u3000]+/g, '')
    .replace(/[.,。、!！?？"']/g, '')
}

async function playQuiz(piece: QuizPiece, session: Session): Promise<void> {
  let at = 0
  let revealed = false
  let correct = 0
  let selection = new Set<string>()
  let typed = ''
  let finished = false

  const draw = () => {
    const question = piece.questions[at]
    if (!question) return
    const columns = session.columns - 6
    const body: string[] = ['']
    for (const line of wrap(question.prompt, columns))
      body.push(`  ${session.paint(line, ansi.bold)}`)
    body.push('')

    if (question.kind === 'short') {
      body.push(
        `   ${session.paint('>', palette.accent)} ${typed}${revealed ? '' : session.paint('_', palette.faint)}`,
      )
    } else {
      for (const choice of question.choices ?? []) {
        const picked = selection.has(choice.id)
        const isAnswer = question.answer.includes(choice.id)
        const marker = revealed
          ? isAnswer
            ? session.paint('✓', palette.ok)
            : picked
              ? session.paint('✗', palette.bad)
              : ' '
          : picked
            ? session.paint('●', palette.accent)
            : '○'
        const lines = wrap(choice.text, columns - 6)
        body.push(`   ${marker} ${session.paint(`${choice.id}.`, palette.muted)} ${lines[0] ?? ''}`)
        for (const line of lines.slice(1)) body.push(`        ${line}`)
      }
    }

    if (revealed) {
      body.push('', session.paint(rule(session.columns), palette.faint))
      for (const line of wrap(`Answer: ${question.answer.join(', ')}`, columns)) {
        body.push(`  ${session.paint(line, palette.ok)}`)
      }
      for (const line of wrap(question.explanation, columns))
        body.push(`  ${session.paint(line, palette.muted)}`)
      if (question.evidence) {
        for (const line of wrap(`> ${question.evidence}`, columns))
          body.push(`  ${session.paint(line, palette.faint)}`)
      }
    }

    session.write(
      frame(
        session,
        [
          session.paint(` ${piece.title}`, ansi.bold),
          session.paint(
            ` question ${at + 1} of ${piece.questions.length}   score ${correct}`,
            palette.faint,
          ),
        ],
        body,
        footerHints(
          session,
          revealed
            ? [
                ['enter', at + 1 >= piece.questions.length ? 'results' : 'next'],
                ['q', 'quit'],
              ]
            : question.kind === 'short'
              ? [
                  ['type', 'your answer'],
                  ['enter', 'check'],
                  ['q', 'quit'],
                ]
              : [
                  ['a-f', 'choose'],
                  ['enter', 'check'],
                  ['q', 'quit'],
                ],
        ),
      ),
    )
  }

  const results = () => {
    finished = true
    const passed = correct >= piece.passScore
    const body = [
      '',
      session.paint(
        centre(`${correct} / ${piece.questions.length}`, session.columns),
        ansi.bold,
        palette.accent,
      ),
      '',
      session.paint(
        centre(
          passed ? 'It stuck.' : `Worth another pass — the bar was ${piece.passScore}.`,
          session.columns,
        ),
        palette.muted,
      ),
    ]
    session.write(
      frame(
        session,
        [session.paint(` ${piece.title}`, ansi.bold), ''],
        body,
        footerHints(session, [['q', 'quit']]),
      ),
    )
  }

  const grade = () => {
    const question = piece.questions[at]
    if (!question) return
    const given =
      question.kind === 'short'
        ? [normalise(typed)].filter(Boolean)
        : [...selection].map(normalise).sort()
    const want = question.answer.map(normalise).sort()
    const ok =
      question.kind === 'short'
        ? given.length > 0 && want.some((value) => given.includes(value))
        : given.length === want.length && given.every((value, index) => value === want[index])
    if (ok) correct += 1
    revealed = true
    draw()
  }

  session.onKey((key) => {
    if (
      key.name === 'char' &&
      key.value === 'q' &&
      (revealed || finished || piece.questions[at]?.kind !== 'short')
    ) {
      return session.end()
    }
    if (finished) return
    const question = piece.questions[at]
    if (!question) return

    if (revealed) {
      if (key.name === 'enter' || (key.name === 'char' && key.value === ' ')) {
        if (at + 1 >= piece.questions.length) return results()
        at += 1
        revealed = false
        selection = new Set()
        typed = ''
        draw()
      }
      return
    }

    if (key.name === 'enter') return grade()

    if (question.kind === 'short') {
      if (key.name === 'backspace') typed = [...typed].slice(0, -1).join('')
      else if (key.name === 'char') typed += key.value
      draw()
      return
    }

    if (key.name === 'char') {
      const id = key.value.toLowerCase()
      if ((question.choices ?? []).some((choice) => choice.id.toLowerCase() === id)) {
        if (question.kind === 'multi') {
          if (selection.has(id)) selection.delete(id)
          else selection.add(id)
        } else {
          selection = new Set([id])
        }
        draw()
      }
    }
  })

  draw()
  await session.wait()
}

/**
 * Play a piece in the terminal.
 *
 * Resolves when the reader quits. Requires a TTY — callers without one should
 * use `renderTuiText` instead.
 */
/** Nothing to play — a format that came back empty still has to say so. */
function hasContent(piece: Piece): boolean {
  switch (piece.format) {
    case 'flipbook':
      return piece.chapters.some((chapter) => chapter.text.length > 0)
    case 'slides':
      return piece.slides.length > 0
    case 'animation':
      return piece.scenes.length > 0
    case 'quiz':
      return piece.questions.length > 0
    default:
      return true
  }
}

/**
 * Play a piece in the terminal.
 *
 * Resolves when the reader quits. Requires a TTY — callers without one should
 * use `renderTuiText` instead.
 */
export async function playTui(piece: Piece, options: PlayOptions = {}): Promise<void> {
  const session = startSession(options)
  try {
    if (!hasContent(piece)) {
      return await playPages(session, transcriptPages(piece, session), 'page')
    }
    switch (piece.format) {
      case 'flipbook':
        return await playFlipbook(piece, session)
      case 'slides':
        return await playPages(session, slidePages(piece, session), 'slide')
      case 'animation':
        return await playAnimation(piece, session)
      case 'quiz':
        return await playQuiz(piece, session)
      default:
        return await playPages(session, transcriptPages(piece, session), 'page')
    }
  } finally {
    session.end()
  }
}
