import type { Document } from './types.js'

/**
 * What a document leans on but never explains.
 *
 * The premise of the whole pipeline is that the sources are the material. That
 * holds right up until the material points somewhere else: a spec that cites
 * RFC 7231 §6.5.1, a design doc that says "the ingest service" and assumes you
 * know which one, a paper that spends a page on an acronym it introduced in a
 * previous paper. A model with only the window in front of it answers anyway,
 * and answers plausibly, which is the failure that costs the reader the most.
 *
 * So ankou says what it does not know. This is deliberately model-free and
 * deliberately shallow: it is a list of leads for whoever can go and look — a
 * host agent with tools, or a reader with a browser — not an attempt to resolve
 * them here.
 */

export type GapKind = 'acronym' | 'citation' | 'link' | 'pointer'

export interface Gap {
  kind: GapKind
  /** The acronym, citation, URL or phrase, as it appears. */
  text: string
  /** How often the document leans on it. */
  count: number
  /** One line of surrounding text, so the lead can be judged without the file. */
  context: string
}

/**
 * Acronyms so common that reporting them is noise. Everything else is reported:
 * a list that tries to know every field's vocabulary would be wrong per field,
 * and a lead the caller discards costs one glance.
 */
const EVERYDAY = new Set([
  // Everyday technical vocabulary.
  'API',
  'APIS',
  'ASCII',
  'CLI',
  'CPU',
  'CSS',
  'CSV',
  'DNS',
  'FAQ',
  'GPU',
  'HTML',
  'HTTP',
  'HTTPS',
  'ID',
  'IDE',
  'IO',
  'JSON',
  'JS',
  'LLM',
  'MIT',
  'OK',
  'OS',
  'PDF',
  'RAM',
  'REST',
  'SDK',
  'SQL',
  'SSH',
  'TLS',
  'TSV',
  'UI',
  'URI',
  'URL',
  'UTC',
  'UTF',
  'UUID',
  'XML',
  'YAML',
  'ZIP',
  // Document furniture, which is shouted rather than abbreviated.
  'README',
  'LICENSE',
  'CHANGELOG',
  'NOTE',
  'NOTES',
  'TIP',
  'INFO',
  'WARNING',
  'IMPORTANT',
  'TODO',
  'FIXME',
  'DEPRECATED',
  'TL',
  'DR',
  'TLDR',
  'AND',
  'OR',
  'NOT',
  // RFC 2119, which every spec shouts and none of them define.
  'MUST',
  'SHOULD',
  'SHALL',
  'MAY',
  'REQUIRED',
  'RECOMMENDED',
  'OPTIONAL',
])

const ACRONYM = /\b[A-Z][A-Z0-9]{1,7}\b/g
const CITATION =
  /\b(?:RFC\s?\d{3,5}|ISO(?:\/IEC)?\s?\d{3,6}(?:[-:]\d+)*|ECMA-\d+|arXiv:\s?\d{4}\.\d{4,5}|doi:\s?10\.\d{4,9}\/\S+|[A-Z]{2,6}-\d{2,6})\b/gi
const LINK = /https?:\/\/[^\s)<>"'\]]+/g
// The trigger is matched in either case, but the target has to be capitalised:
// making the whole thing case-insensitive turns every "see the file" into a lead.
const POINTER =
  /\b(?:[Ss]ee|[Rr]efer to|[Dd]escribed in|[Dd]ocumented in|[Dd]efined in|[Pp]er|[Aa]ccording to|詳しくは|参照|に従って)\s+(?:the\s+)?([A-Z][\w./-]*(?:\s+[A-Z][\w./-]*){0,4}|[「『][^」』]{2,40}[」』])/g

/** One line around the first hit, trimmed to something quotable. */
function contextOf(text: string, needle: string): string {
  const at = text.indexOf(needle)
  if (at === -1) return ''
  const from = Math.max(0, text.lastIndexOf('\n', at) + 1)
  const to = text.indexOf('\n', at)
  const line = text.slice(from, to === -1 ? undefined : to).trim()
  return line.length > 160 ? `${line.slice(0, 157)}…` : line
}

/**
 * An acronym counts as explained when the document spells it out next to it —
 * `Retrieval Augmented Generation (RAG)`, or `RAG (Retrieval Augmented
 * Generation)`. Anything looser than that is a guess, and a guess here means
 * quietly dropping a real gap.
 */
function isExpanded(text: string, acronym: string): boolean {
  const letters = [...acronym].filter((character) => /[A-Z]/.test(character))
  if (letters.length < 2) return true
  const spelled = letters.map((letter) => `${letter}\\w+`).join('[\\s\\-]+')
  const before = new RegExp(`${spelled}[\\s\\-]*\\(\\s*${acronym}\\s*\\)`, 'i')
  const after = new RegExp(`${acronym}\\s*\\(\\s*${spelled}`, 'i')
  return before.test(text) || after.test(text)
}

function add(into: Map<string, Gap>, kind: GapKind, text: string, source: string): void {
  const key = `${kind}:${text.toLowerCase()}`
  const found = into.get(key)
  if (found) {
    found.count += 1
    return
  }
  into.set(key, { kind, text, count: 1, context: contextOf(source, text) })
}

export interface GapOptions {
  /** Drop leads mentioned fewer times than this. Default 1 — report everything. */
  minCount?: number
  /** Most leads to return, highest count first. Default 40. */
  limit?: number
}

/** Leads for whoever can go and look, most-leaned-on first. */
export function gaps(documents: Document[], options: GapOptions = {}): Gap[] {
  const found = new Map<string, Gap>()

  for (const document of documents) {
    const text = document.text

    for (const [match] of text.matchAll(ACRONYM)) {
      if (EVERYDAY.has(match) || isExpanded(text, match)) continue
      add(found, 'acronym', match, text)
    }
    for (const [match] of text.matchAll(CITATION)) add(found, 'citation', match.trim(), text)
    for (const [match] of text.matchAll(LINK)) {
      add(found, 'link', match.replace(/[.,;:]+$/, ''), text)
    }
    for (const match of text.matchAll(POINTER)) {
      const target = match[1]?.trim()
      if (target && target.length > 2) add(found, 'pointer', target, text)
    }
  }

  const minCount = options.minCount ?? 1
  return [...found.values()]
    .filter((gap) => gap.count >= minCount)
    .sort((a, b) => b.count - a.count || a.text.localeCompare(b.text))
    .slice(0, options.limit ?? 40)
}
