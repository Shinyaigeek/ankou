/** Terminal primitives: colour, width-aware wrapping, screen control. */

const ESC = '\u001b'
const CSI = `${ESC}[`

export const ansi = {
  reset: `${CSI}0m`,
  bold: `${CSI}1m`,
  dim: `${CSI}2m`,
  italic: `${CSI}3m`,
  underline: `${CSI}4m`,
  inverse: `${CSI}7m`,
  fg: (code: number) => `${CSI}38;5;${code}m`,
  bg: (code: number) => `${CSI}48;5;${code}m`,
}

/** kamu's terminal palette, in 256-colour codes so it survives ssh and tmux. */
export const palette = {
  accent: ansi.fg(208),
  accentDim: ansi.fg(130),
  muted: ansi.fg(244),
  faint: ansi.fg(240),
  ok: ansi.fg(71),
  bad: ansi.fg(167),
}

export function paint(text: string, ...codes: string[]): string {
  return `${codes.join('')}${text}${ansi.reset}`
}

const ANSI_PATTERN = new RegExp(`${ESC}\\[[0-9;]*[A-Za-z]`, 'g')

export function stripAnsi(text: string): string {
  return text.replace(ANSI_PATTERN, '')
}

/**
 * Display width of a string in terminal cells. Full-width CJK, Hangul and emoji
 * occupy two columns; combining marks occupy none. Without this, every Japanese
 * line would overflow its box.
 */
export function charWidth(codePoint: number): number {
  if (codePoint === 0) return 0
  if (codePoint < 32 || (codePoint >= 0x7f && codePoint < 0xa0)) return 0
  if (
    (codePoint >= 0x0300 && codePoint <= 0x036f) ||
    (codePoint >= 0x200b && codePoint <= 0x200f) ||
    codePoint === 0xfe0f
  ) {
    return 0
  }
  const wide =
    (codePoint >= 0x1100 && codePoint <= 0x115f) ||
    (codePoint >= 0x2e80 && codePoint <= 0x303e) ||
    (codePoint >= 0x3041 && codePoint <= 0x33ff) ||
    (codePoint >= 0x3400 && codePoint <= 0x4dbf) ||
    (codePoint >= 0x4e00 && codePoint <= 0x9fff) ||
    (codePoint >= 0xa000 && codePoint <= 0xa4cf) ||
    (codePoint >= 0xac00 && codePoint <= 0xd7a3) ||
    (codePoint >= 0xf900 && codePoint <= 0xfaff) ||
    (codePoint >= 0xfe30 && codePoint <= 0xfe6f) ||
    (codePoint >= 0xff00 && codePoint <= 0xff60) ||
    (codePoint >= 0xffe0 && codePoint <= 0xffe6) ||
    (codePoint >= 0x1f300 && codePoint <= 0x1f64f) ||
    (codePoint >= 0x1f900 && codePoint <= 0x1f9ff) ||
    (codePoint >= 0x20000 && codePoint <= 0x3fffd)
  return wide ? 2 : 1
}

export function width(text: string): number {
  let total = 0
  for (const char of stripAnsi(text)) total += charWidth(char.codePointAt(0) ?? 0)
  return total
}

/** Hard-wrap to `columns`, breaking on spaces where the language has them. */
export function wrap(text: string, columns: number): string[] {
  const lines: string[] = []
  for (const paragraph of text.split('\n')) {
    if (!paragraph) {
      lines.push('')
      continue
    }
    let line = ''
    let lineWidth = 0
    let lastBreak = -1
    for (const char of paragraph) {
      const w = charWidth(char.codePointAt(0) ?? 0)
      if (lineWidth + w > columns) {
        // Prefer the last space so Latin text does not break mid-word.
        if (lastBreak > 0 && lineWidth - lastBreak < columns * 0.4) {
          lines.push(line.slice(0, lastBreak).trimEnd())
          line = line.slice(lastBreak).trimStart()
          lineWidth = width(line)
        } else {
          lines.push(line)
          line = ''
          lineWidth = 0
        }
        lastBreak = -1
      }
      line += char
      lineWidth += w
      if (char === ' ') lastBreak = line.length
    }
    lines.push(line)
  }
  return lines
}

export function pad(text: string, columns: number): string {
  return text + ' '.repeat(Math.max(0, columns - width(text)))
}

export function centre(text: string, columns: number): string {
  const left = Math.max(0, Math.floor((columns - width(text)) / 2))
  return ' '.repeat(left) + text
}

export function rule(columns: number, char = '─'): string {
  return char.repeat(Math.max(0, columns))
}

export const screen = {
  enter: `${CSI}?1049h${CSI}?25l`,
  exit: `${CSI}?25h${CSI}?1049l`,
  clear: `${CSI}2J${CSI}H`,
  home: `${CSI}H`,
  hideCursor: `${CSI}?25l`,
  showCursor: `${CSI}?25h`,
}

export function supportsColour(stream: { isTTY?: boolean } = process.stdout): boolean {
  if (process.env.NO_COLOR) return false
  if (process.env.FORCE_COLOR) return true
  return Boolean(stream.isTTY)
}
