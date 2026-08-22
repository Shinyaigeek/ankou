import { ingestError } from '../errors.js'
import type { Document } from '../types.js'
import { charCount, detectLang, normaliseText, shortHash } from '../util/text.js'
import { inferSections } from './text.js'

/**
 * PDF text extraction is delegated to `unpdf` (a pdf.js build without the DOM
 * requirements). It is an optional peer dependency: the rest of kamu works
 * without it, and PDFs fail with an actionable message instead of a stack.
 */
async function extract(
  bytes: Uint8Array,
): Promise<{ pages: string[]; info: Record<string, unknown> }> {
  let unpdf: typeof import('unpdf')
  try {
    unpdf = await import('unpdf')
  } catch {
    throw ingestError(
      'PDF support requires the optional `unpdf` package.',
      'Install it with `npm i unpdf` (or `pnpm add unpdf`) in the project that runs kamu.',
    )
  }
  const pdf = await unpdf.getDocumentProxy(bytes)
  const { text } = await unpdf.extractText(pdf, { mergePages: false })
  const meta = await unpdf.getMeta(pdf).catch(() => null)
  return {
    pages: Array.isArray(text) ? text : [String(text)],
    info: (meta?.info as Record<string, unknown>) ?? {},
  }
}

/**
 * Reflow extracted page text.
 *
 * PDF extraction emits a hard line break at every typeset line, which would
 * otherwise read as a paragraph break. The classic fix works on the measure:
 * lines that run the full width of the text block are continuations, and a line
 * noticeably shorter than the measure is the end of its paragraph.
 */
/** A well-formed roman numeral, so that `civil` and `ill` are words again. */
const ROMAN = /^(?=[ivxlcdm])m*(c[md]|d?c{0,3})(x[cl]|l?x{0,3})(i[xv]|v?i{0,3})$/i

const looksLikeFolio = (line: string) => /^\d{1,4}$/.test(line) || ROMAN.test(line)

export function reflowPdfText(page: string): string {
  const lines = page.split('\n').map((line) => line.trim())
  const measure = lines.reduce((longest, line) => Math.max(longest, line.length), 0)
  if (measure === 0) return ''

  // A folio sits at the top or the bottom of the page. Anywhere else, a lone
  // number is content — a year in a bibliography, a figure in a table — and
  // deleting it changes what the source says. Measured on a real paper: every
  // page number was within two lines of an edge, and every false positive was
  // not.
  const filled = lines.flatMap((line, index) => (line ? [index] : []))
  const edges = new Set([...filled.slice(0, 2), ...filled.slice(-2)])

  const out: string[] = []
  let buffer = ''

  const flush = () => {
    if (buffer.trim()) out.push(buffer.trim())
    buffer = ''
  }

  for (const [index, line] of lines.entries()) {
    if (!line) {
      flush()
      continue
    }
    if (edges.has(index) && looksLikeFolio(line)) continue

    // Headings sit far inside the measure and carry no terminal punctuation.
    const isHeading = !buffer && line.length <= measure * 0.5 && !/[.。!！?？,、;:]$/.test(line)
    if (isHeading) {
      out.push(line)
      continue
    }

    if (buffer.endsWith('-')) buffer = buffer.slice(0, -1) + line
    else if (/[\u3000-\u9fff\uff00-\uffef]$/.test(buffer)) buffer += line
    else buffer = buffer ? `${buffer} ${line}` : line

    // Short of the measure means the paragraph ended here.
    if (line.length < measure * 0.85) flush()
  }
  flush()
  return out.join('\n\n')
}

export async function documentFromPdf(
  bytes: Uint8Array,
  ref: string,
  name?: string,
): Promise<Document> {
  const { pages, info } = await extract(bytes)
  const body = pages.map(reflowPdfText).filter(Boolean).join('\n\n')
  const text = normaliseText(body)
  if (!text) {
    throw ingestError(
      `No extractable text in ${ref}.`,
      'The PDF is probably a scan. Run OCR on it first, then feed the result to kamu.',
    )
  }
  const title = String(info.Title ?? '').trim() || name || 'Untitled PDF'
  return {
    id: shortHash(ref + text.slice(0, 512)),
    title,
    origin: { kind: 'pdf', ref },
    text,
    sections: inferSections(text),
    meta: { ...info, pageCount: pages.length },
    charCount: charCount(text),
    lang: detectLang(text),
  }
}
