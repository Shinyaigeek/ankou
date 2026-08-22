/** Text utilities shared by ingestion and composition. */

/** Collapse Windows newlines and runs of blank lines, and trim trailing spaces. */
export function normaliseText(input: string): string {
  return input
    .replace(/\r\n?/g, '\n')
    .replace(/\u00a0/g, ' ')
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/g, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/**
 * Best-effort language detection. We only need enough to pick prompts, pacing
 * and typography, so a script-frequency heuristic beats pulling in a dependency.
 */
export function detectLang(text: string): string {
  const sample = text.slice(0, 4000)
  if (!sample) return 'en'
  const counts = {
    ja: (sample.match(/[\u3040-\u30ff]/g) ?? []).length,
    han: (sample.match(/[\u4e00-\u9fff]/g) ?? []).length,
    ko: (sample.match(/[\uac00-\ud7af]/g) ?? []).length,
    cyrillic: (sample.match(/[\u0400-\u04ff]/g) ?? []).length,
  }
  const total = sample.length
  if (counts.ja / total > 0.05) return 'ja'
  if (counts.ko / total > 0.05) return 'ko'
  if (counts.han / total > 0.05) return 'zh'
  if (counts.cyrillic / total > 0.1) return 'ru'
  return 'en'
}

/** CJK text has no spaces, so a character budget is the portable unit. */
export function charCount(text: string): number {
  return [...text].length
}

/** Split into grapheme clusters so surrogate pairs and emoji stay whole. */
export function graphemes(text: string): string[] {
  const Seg = (Intl as unknown as { Segmenter?: typeof Intl.Segmenter }).Segmenter
  if (Seg) {
    const seg = new Seg(undefined, { granularity: 'grapheme' })
    return [...seg.segment(text)].map((s) => s.segment)
  }
  return [...text]
}

/**
 * Split a document into windows that fit a character budget, preferring
 * paragraph boundaries so a window never starts mid-sentence.
 */
export function windows(text: string, budget: number, overlap = 0): string[] {
  const size = Math.max(1, Math.floor(budget))
  // Overlap is carried context, not a second copy of the window. At the window
  // size it makes no progress at all — the next window starts where this one
  // did, and the loop below runs forever, which `--window 200` reached in one
  // step because composition always asks for 200 characters of overlap. A
  // quarter is the most that can still be called carried context.
  const back = Math.min(Math.max(0, Math.floor(overlap)), Math.floor(size / 4))

  if (charCount(text) <= size) return [text]
  const paragraphs = text.split(/\n{2,}/)
  const out: string[] = []
  let current = ''
  for (const para of paragraphs) {
    if (current && charCount(current) + charCount(para) + 2 > size) {
      out.push(current)
      current = back > 0 ? `${tail(current, back)}\n\n${para}` : para
    } else {
      current = current ? `${current}\n\n${para}` : para
    }
    // A single paragraph larger than the window still has to be broken up.
    // Sliced by code point, so a surrogate pair is never cut in half.
    while (charCount(current) > size) {
      const points = [...current]
      out.push(points.slice(0, size).join(''))
      current = points.slice(size - back).join('')
    }
  }
  if (current.trim()) out.push(current)
  return out
}

/** The last `count` characters, counted the way `charCount` counts them. */
function tail(text: string, count: number): string {
  const points = [...text]
  return points.slice(Math.max(0, points.length - count)).join('')
}

/** Stable id from a string, good enough for document identity in one run. */
export function shortHash(input: string): string {
  let h1 = 0x811c9dc5
  let h2 = 0x01000193
  for (let i = 0; i < input.length; i++) {
    const c = input.charCodeAt(i)
    h1 = Math.imul(h1 ^ c, 0x01000193)
    h2 = Math.imul(h2 + c, 0x85ebca6b) ^ (h2 >>> 13)
  }
  const hex = (n: number) => (n >>> 0).toString(16).padStart(8, '0')
  return hex(h1) + hex(h2)
}

/** Escape for embedding inside an HTML text node or attribute. */
export function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** Escape a string for safe embedding in a `<script>` JSON payload. */
export function escapeJson(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029')
}
