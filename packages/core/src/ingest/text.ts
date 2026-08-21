import type { Document, Section } from '../types.js'
import { charCount, detectLang, normaliseText, shortHash } from '../util/text.js'

/**
 * Plain text has no structure, so we infer it: a short line that is followed by
 * a blank line and is not sentence-terminated reads as a heading.
 */
export function inferSections(text: string): Section[] {
  const blocks = text.split(/\n{2,}/)
  const sections: Section[] = []
  let current: Section = { level: 1, title: '', text: '' }

  for (const block of blocks) {
    const trimmed = block.trim()
    const isHeading =
      trimmed.length > 0 &&
      trimmed.length <= 60 &&
      !trimmed.includes('\n') &&
      !/[.。!！?？:：,、]$/.test(trimmed)
    if (isHeading) {
      if (current.title || current.text.trim())
        sections.push({ ...current, text: current.text.trim() })
      current = { level: 1, title: trimmed, text: '' }
    } else {
      current.text += `${trimmed}\n\n`
    }
  }
  if (current.title || current.text.trim()) sections.push({ ...current, text: current.text.trim() })
  return sections.length > 0 ? sections : [{ level: 1, title: '', text }]
}

export function documentFromText(raw: string, ref: string, name?: string): Document {
  const text = normaliseText(raw)
  const firstLine = text.split('\n')[0]?.trim() ?? ''
  const title =
    name || (firstLine.length <= 80 ? firstLine : `${firstLine.slice(0, 77)}...`) || 'Untitled'
  return {
    id: shortHash(ref + text.slice(0, 512)),
    title,
    origin: { kind: 'text', ref },
    text,
    sections: inferSections(text),
    meta: {},
    charCount: charCount(text),
    lang: detectLang(text),
  }
}
