import type { Piece } from '../../types.js'
import { ansi, centre, paint, palette, rule, supportsColour, wrap } from './term.js'

export interface TuiTextOptions {
  columns?: number
  colour?: boolean
}

/**
 * The non-interactive form of the terminal renderer: a transcript.
 *
 * `ankou ... --render tui` in a pipe or a CI log has nothing to interact with,
 * so it gets this instead of an empty screen.
 */
export function renderTuiText(piece: Piece, options: TuiTextOptions = {}): string {
  const columns = Math.max(28, Math.min(options.columns ?? process.stdout.columns ?? 80, 110))
  const colour = options.colour ?? supportsColour()
  const c = (text: string, ...codes: string[]) => (colour ? paint(text, ...codes) : text)

  const out: string[] = []
  const heading = (text: string) => {
    out.push('', c(text.toUpperCase(), ansi.bold, palette.accent), c(rule(columns), palette.faint))
  }
  const para = (text: string, indent = '') => {
    for (const line of wrap(text, columns - indent.length)) out.push(indent + line)
  }

  out.push(c(centre(piece.title, columns), ansi.bold))
  out.push(
    c(
      centre(`${piece.format} · ${piece.meta.sources.map((s) => s.title).join(', ')}`, columns),
      palette.faint,
    ),
  )
  out.push('')

  switch (piece.format) {
    case 'flipbook': {
      for (const [index, chapter] of piece.chapters.entries()) {
        heading(`${index + 1}. ${chapter.title}`)
        para(chapter.text)
      }
      if (piece.emphasis.length) {
        heading('Emphasis')
        for (const item of piece.emphasis) {
          para(`${c(item.term, palette.accent)}${item.gloss ? ` — ${item.gloss}` : ''}`, '  ')
        }
      }
      break
    }

    case 'slides': {
      for (const [index, slide] of piece.slides.entries()) {
        heading(`${index + 1}. ${slide.title}`)
        for (const bullet of slide.bullets) para(`${c('•', palette.accent)} ${bullet}`, '  ')
        if (slide.visual?.type === 'quote') para(c(`"${slide.visual.text}"`, ansi.italic), '  ')
        if (slide.visual?.type === 'stat') {
          para(`${c(slide.visual.value, ansi.bold, palette.accent)} ${slide.visual.caption}`, '  ')
        }
        if (slide.visual?.type === 'code' || slide.visual?.type === 'mermaid') {
          for (const line of slide.visual.code.split('\n'))
            out.push(`    ${c(line, palette.muted)}`)
        }
        if (slide.notes) para(c(slide.notes, palette.faint), '  ')
      }
      break
    }

    case 'quiz': {
      for (const [index, question] of piece.questions.entries()) {
        heading(`Q${index + 1}`)
        para(question.prompt)
        for (const choice of question.choices ?? []) {
          para(`${c(`${choice.id}.`, palette.muted)} ${choice.text}`, '  ')
        }
        out.push('')
        para(`${c('Answer:', palette.ok)} ${question.answer.join(', ')}`, '  ')
        para(c(question.explanation, palette.muted), '  ')
        if (question.evidence) para(c(`> ${question.evidence}`, palette.faint), '  ')
      }
      break
    }

    case 'animation': {
      for (const [index, scene] of piece.scenes.entries()) {
        heading(`Scene ${index + 1} · ${scene.motion} · ${scene.mood}`)
        for (const line of scene.lines) {
          para(line.accent ? c(line.text, palette.accent, ansi.bold) : line.text, '  ')
        }
      }
      break
    }

    case 'summary': {
      heading('TL;DR')
      para(piece.tldr)
      if (piece.keyPoints.length) {
        heading('Key points')
        for (const point of piece.keyPoints) {
          para(`${c('•', palette.accent)} ${point.text}`, '  ')
          if (point.detail) para(c(point.detail, palette.muted), '    ')
        }
      }
      for (const item of piece.outline) {
        heading(item.title)
        para(item.summary)
        for (const point of item.points) para(`- ${point}`, '  ')
      }
      if (piece.glossary.length) {
        heading('Glossary')
        for (const entry of piece.glossary) {
          para(`${c(entry.term, palette.accent)} — ${entry.definition}`, '  ')
        }
      }
      if (piece.openQuestions.length) {
        heading('Left open')
        for (const question of piece.openQuestions) para(`? ${question}`, '  ')
      }
      break
    }

    case 'dialogue': {
      const names = new Map(piece.speakers.map((speaker) => [speaker.id, speaker.name]))
      out.push('')
      for (const turn of piece.turns) {
        const name = names.get(turn.speaker) ?? turn.speaker
        out.push(c(`${name}:`, ansi.bold, palette.accent))
        para(turn.text, '  ')
        out.push('')
      }
      break
    }
  }

  out.push('', c(centre('carved by ankou', columns), palette.faint))
  return `${out.join('\n')}\n`
}
