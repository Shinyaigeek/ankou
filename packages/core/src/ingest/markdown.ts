import type { Document, Section } from '../types.js'
import { charCount, detectLang, normaliseText, shortHash } from '../util/text.js'

/** Split markdown on ATX headings into sections, keeping the prose verbatim. */
export function splitMarkdownSections(text: string): Section[] {
  const lines = text.split('\n')
  const sections: Section[] = []
  let current: Section | null = null
  let inFence = false

  for (const line of lines) {
    if (/^\s*(```|~~~)/.test(line)) inFence = !inFence
    const heading = inFence ? null : /^(#{1,6})\s+(.*)$/.exec(line)
    if (heading) {
      if (current) sections.push({ ...current, text: current.text.trim() })
      current = { level: heading[1]!.length, title: heading[2]!.trim(), text: '' }
    } else if (current) {
      current.text += `${line}\n`
    } else if (line.trim()) {
      current = { level: 1, title: '', text: `${line}\n` }
    }
  }
  if (current) sections.push({ ...current, text: current.text.trim() })
  return sections.filter((s) => s.title || s.text)
}

/** Strip markdown syntax down to the words a reader would actually speak. */
export function markdownToPlain(md: string): string {
  return md
    .replace(/^---\n[\s\S]*?\n---\n/, '') // front matter
    .replace(/```[\s\S]*?```/g, (block) => block.replace(/^```.*$/gm, '').trim())
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}>\s?/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '・')
    .replace(/(\*\*|__)(.*?)\1/g, '$2')
    .replace(/(\*|_)(.*?)\1/g, '$2')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/^\s*#{1,6}\s+/gm, '')
}

export function parseFrontMatter(text: string): { meta: Record<string, unknown>; body: string } {
  const match = /^---\n([\s\S]*?)\n---\n?/.exec(text)
  if (!match) return { meta: {}, body: text }
  const meta: Record<string, unknown> = {}
  for (const line of match[1]!.split('\n')) {
    const kv = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line)
    if (kv) meta[kv[1]!] = kv[2]!.replace(/^["']|["']$/g, '')
  }
  return { meta, body: text.slice(match[0].length) }
}

export function documentFromMarkdown(raw: string, ref: string, name?: string): Document {
  const { meta, body } = parseFrontMatter(normaliseText(raw))
  const sections = splitMarkdownSections(body)
  const firstHeading = sections.find((s) => s.title)?.title
  const title = String(meta.title ?? '') || firstHeading || name || 'Untitled'
  const text = normaliseText(markdownToPlain(body))
  return {
    id: shortHash(ref + text.slice(0, 512)),
    title,
    origin: { kind: 'markdown', ref },
    text,
    sections: sections.map((s) => ({ ...s, text: normaliseText(markdownToPlain(s.text)) })),
    meta,
    charCount: charCount(text),
    lang: detectLang(text),
  }
}
