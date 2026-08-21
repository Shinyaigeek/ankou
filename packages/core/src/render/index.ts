import type { Piece, RendererId, RenderOptions, RenderResult } from '../types.js'
import { renderHtml } from './html/index.js'
import { renderTuiText } from './tui/text.js'

export * from './html/index.js'
export { type PlayOptions, playTui } from './tui/play.js'
export * as term from './tui/term.js'
export { renderTuiText } from './tui/text.js'

export const RENDERERS: RendererId[] = ['html', 'tui', 'json']

export function isRendererId(value: string): value is RendererId {
  return (RENDERERS as string[]).includes(value)
}

/**
 * Render a piece to text.
 *
 * `html` gives a self-contained page, `json` gives the intermediate
 * representation, and `tui` gives a transcript — the interactive terminal
 * player lives in `playTui`, since a live session is not a string.
 */
export function render(
  piece: Piece,
  renderer: RendererId = 'html',
  options: RenderOptions = {},
): RenderResult {
  switch (renderer) {
    case 'html':
      return {
        renderer,
        ext: 'html',
        mime: 'text/html; charset=utf-8',
        content: renderHtml(piece, options.theme ?? 'auto'),
      }
    case 'tui':
      return {
        renderer,
        ext: 'txt',
        mime: 'text/plain; charset=utf-8',
        content: renderTuiText(piece, {
          columns: options.columns as number | undefined,
          colour: options.colour as boolean | undefined,
        }),
      }
    case 'json':
      return {
        renderer,
        ext: 'json',
        mime: 'application/json',
        content: `${JSON.stringify(piece, null, 2)}\n`,
      }
  }
}
