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
 * Is this a piece kamu can still work with?
 *
 * A `Piece` is meant to outlive the run that made it — cached, stored, handed to
 * another program — so something has to check what comes back. The discriminant
 * is the whole check on purpose: the renderers already tolerate a thin piece,
 * and anything stricter would reject one written by a version that knew a field
 * fewer, which is exactly the case worth surviving.
 */
export function isPiece(value: unknown): value is Piece {
  if (!value || typeof value !== 'object') return false
  const { format } = value as { format?: unknown }
  return typeof format === 'string' && isFormatId(format)
}
