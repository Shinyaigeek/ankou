import type { FormatId, Piece } from '../types.js'
import { animation } from './animation.js'
import type { FormatModule } from './base.js'
import { dialogue } from './dialogue.js'
import { flipbook } from './flipbook.js'
import { quiz } from './quiz.js'
import { slides } from './slides.js'
import { summary } from './summary.js'

export * from './base.js'
export { animation, dialogue, flipbook, quiz, slides, summary }

/** Every format, keyed by id. Adding one here is all it takes to register it. */
export const FORMATS = {
  flipbook,
  slides,
  quiz,
  animation,
  summary,
  dialogue,
} satisfies { [F in FormatId]: FormatModule<F> }

export const FORMAT_IDS = Object.keys(FORMATS) as FormatId[]

export function getFormat<F extends FormatId>(id: F): FormatModule<F> {
  return FORMATS[id] as unknown as FormatModule<F>
}

export function isFormatId(value: string): value is FormatId {
  return (FORMAT_IDS as string[]).includes(value)
}

/**
 * What a piece of each format has to carry for the renderers to read it.
 *
 * Measured rather than guessed: each field here is one whose absence makes at
 * least one renderer throw. The type declares them all as required, so a piece
 * missing any of them was not written by a version of kamu — it was truncated,
 * hand-edited, or produced by something else.
 */
const REQUIRED: Record<FormatId, string[]> = {
  flipbook: ['chapters', 'emphasis', 'ruby', 'pacing'],
  slides: ['slides'],
  quiz: ['questions'],
  animation: ['scenes'],
  summary: ['tldr', 'keyPoints', 'outline', 'glossary', 'openQuestions'],
  dialogue: ['speakers', 'turns'],
}

/**
 * What stops this from being a piece kamu can render, if anything.
 *
 * A `Piece` is meant to outlive the run that made it — cached, stored, handed to
 * another program, read back by `kamu render` — so something has to check what
 * comes back. Checking only the discriminant was not enough: every renderer
 * reads `meta.sources` and its own format's collections, so a piece carrying
 * neither reached them and threw a bare TypeError at the reader instead of an
 * answer.
 */
export function pieceProblems(value: unknown): string[] {
  if (!value || typeof value !== 'object') return ['not an object']
  const piece = value as Record<string, unknown>

  if (typeof piece.format !== 'string' || !isFormatId(piece.format)) {
    return [`\`format\` must be one of: ${FORMAT_IDS.join(', ')}`]
  }

  const missing: string[] = []
  for (const field of ['title', 'lang'] as const) {
    if (typeof piece[field] !== 'string') missing.push(field)
  }
  const meta = piece.meta as { sources?: unknown } | undefined
  if (!meta || typeof meta !== 'object' || !Array.isArray(meta.sources))
    missing.push('meta.sources')
  for (const field of REQUIRED[piece.format]) {
    if (piece[field] === undefined) missing.push(field)
  }
  return missing
}

/** Is this a piece kamu can render? See `pieceProblems` for what that means. */
export function isPiece(value: unknown): value is Piece {
  return pieceProblems(value).length === 0
}
