import type { Piece } from '../../types.js'
import { renderAnimationHtml } from './animation.js'
import { renderDialogueHtml } from './dialogue.js'
import { renderFlipbookHtml } from './flipbook.js'
import { renderQuizHtml } from './quiz.js'
import { renderSlidesHtml } from './slides.js'
import { renderSummaryHtml } from './summary.js'

export { htmlDocument } from './shell.js'
export {
  renderAnimationHtml,
  renderDialogueHtml,
  renderFlipbookHtml,
  renderQuizHtml,
  renderSlidesHtml,
  renderSummaryHtml,
}

/**
 * Render a piece to one self-contained HTML file: no CDN, no fonts to fetch, no
 * build step. Open it, mail it, drop it on a static host — it works offline and
 * it follows the reader's colour scheme.
 */
export function renderHtml(piece: Piece, theme: 'dark' | 'light' | 'auto' = 'auto'): string {
  switch (piece.format) {
    case 'flipbook':
      return renderFlipbookHtml(piece, theme)
    case 'slides':
      return renderSlidesHtml(piece, theme)
    case 'quiz':
      return renderQuizHtml(piece, theme)
    case 'animation':
      return renderAnimationHtml(piece, theme)
    case 'summary':
      return renderSummaryHtml(piece, theme)
    case 'dialogue':
      return renderDialogueHtml(piece, theme)
  }
}
