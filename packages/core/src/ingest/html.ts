import type { Document } from '../types.js'
import { charCount, detectLang, normaliseText, shortHash } from '../util/text.js'
import {
  type ElementNode,
  findAll,
  findFirst,
  type Node,
  parseHtml,
  textOf,
  walk,
} from './html-parse.js'
import { splitMarkdownSections } from './markdown.js'

/** Chrome that is never the article, no matter how much text it holds. */
const BOILERPLATE = new Set([
  'script',
  'style',
  'noscript',
  'svg',
  'canvas',
  'iframe',
  'template',
  'form',
  'nav',
  'header',
  'footer',
  'aside',
  'button',
  'select',
  'option',
  'label',
])

const BOILERPLATE_HINT =
  /(^|[\s_-])(nav|menu|sidebar|side-bar|footer|header|comment|share|social|promo|advert|ads?|banner|cookie|subscribe|newsletter|related|recommend|breadcrumb|pagination|toolbar|masthead|navbox|navigation|portal-bar|sistersitebox|authority-control|metadata|catlinks|editsection|noprint|printfooter|sitesub|contentsub|jump-link|skip-link|byline-social)([\s_-]|$)/i

const CONTENT_HINT =
  /(^|[\s_-])(article|content|post|entry|main|story|body-copy|markdown|prose|readme)([\s_-]|$)/i

function isHidden(node: ElementNode): boolean {
  if (node.attrs.hidden !== undefined) return true
  if (node.attrs['aria-hidden'] === 'true') return true
  return /display\s*:\s*none|visibility\s*:\s*hidden/i.test(node.attrs.style ?? '')
}

function prune(root: ElementNode): void {
  walk(root, (node) => {
    if (node.type !== 'element') return
    node.children = node.children.filter((child) => {
      if (child.type !== 'element') return true
      if (BOILERPLATE.has(child.tag)) return false
      if (isHidden(child)) return false
      const hint = `${child.attrs.class ?? ''} ${child.attrs.id ?? ''} ${child.attrs.role ?? ''}`
      if (BOILERPLATE_HINT.test(hint) && !CONTENT_HINT.test(hint)) return false
      return true
    })
  })
}

/**
 * Readability-style scoring: prefer containers with lots of prose and few
 * links, since navigation blocks are mostly anchor text.
 */
function score(node: ElementNode): number {
  const text = textOf(node).replace(/\s+/g, ' ').trim()
  const length = charCount(text)
  if (length < 140) return 0
  const linkLength = findAll(node, 'a').reduce((sum, a) => sum + charCount(textOf(a).trim()), 0)
  const linkDensity = linkLength / Math.max(length, 1)
  const paragraphs = findAll(node, 'p').length
  const commas = (text.match(/[,、,]/g) ?? []).length

  let value = length * (1 - Math.min(linkDensity * 1.6, 0.95))
  value += paragraphs * 40 + commas * 4
  if (node.tag === 'article' || node.tag === 'main') value *= 1.6
  const hint = `${node.attrs.class ?? ''} ${node.attrs.id ?? ''}`
  if (CONTENT_HINT.test(hint)) value *= 1.35
  return value
}

function pickMainContent(root: ElementNode): ElementNode {
  const candidates: ElementNode[] = []
  walk(root, (node) => {
    if (
      node.type === 'element' &&
      ['article', 'main', 'section', 'div', 'body'].includes(node.tag)
    ) {
      candidates.push(node)
    }
  })
  let best = root
  let bestScore = 0
  for (const candidate of candidates) {
    const value = score(candidate)
    // Ties go to the deeper node so we do not keep the whole <body>.
    if (value > bestScore * 1.05) {
      best = candidate
      bestScore = value
    }
  }
  return bestScore > 0 ? best : (findFirst(root, 'body') ?? root)
}

/** Serialise the kept subtree into light markdown. */
function toMarkdown(node: Node, depth = 0): string {
  if (node.type === 'text') return node.value.replace(/\s+/g, ' ')
  const inner = () => node.children.map((child) => toMarkdown(child, depth + 1)).join('')
  switch (node.tag) {
    case 'script':
    case 'style':
    case 'noscript':
      return ''
    case 'br':
      return '\n'
    case 'hr':
      return '\n\n---\n\n'
    case 'h1':
    case 'h2':
    case 'h3':
    case 'h4':
    case 'h5':
    case 'h6':
      return `\n\n${'#'.repeat(Number(node.tag[1]))} ${inner().trim()}\n\n`
    case 'p':
    case 'div':
    case 'section':
    case 'article':
    case 'main':
    case 'figcaption':
    case 'tr':
      return `\n\n${inner().trim()}\n\n`
    case 'li':
      return `\n- ${inner().trim()}`
    case 'ul':
    case 'ol':
      return `\n${inner()}\n\n`
    case 'blockquote':
      return `\n\n> ${inner().trim().replace(/\n+/g, '\n> ')}\n\n`
    case 'pre': {
      const code = textOf(node).replace(/\n+$/, '')
      return `\n\n\`\`\`\n${code}\n\`\`\`\n\n`
    }
    case 'code':
      return node.parent?.tag === 'pre' ? inner() : `\`${inner().trim()}\``
    case 'img': {
      const alt = node.attrs.alt?.trim()
      return alt ? ` (${alt}) ` : ''
    }
    case 'td':
    case 'th':
      return `${inner().trim()} | `
    default:
      return inner()
  }
}

export interface HtmlIngestOptions {
  /** Skip content extraction and keep the whole body. */
  full?: boolean
}

export function documentFromHtml(
  raw: string,
  ref: string,
  name?: string,
  options: HtmlIngestOptions = {},
): Document {
  const root = parseHtml(raw)
  const meta: Record<string, unknown> = {}
  for (const tag of findAll(root, 'meta')) {
    const key = tag.attrs.property ?? tag.attrs.name
    if (key && tag.attrs.content) meta[key] = tag.attrs.content
  }
  const htmlLangAttr = findFirst(root, 'html')?.attrs.lang
  const docTitle =
    String(meta['og:title'] ?? '') ||
    textOf(findFirst(root, 'title') ?? { type: 'text', value: '', parent: null }).trim() ||
    textOf(findFirst(root, 'h1') ?? { type: 'text', value: '', parent: null }).trim() ||
    name ||
    'Untitled'

  prune(root)
  const content = options.full ? (findFirst(root, 'body') ?? root) : pickMainContent(root)
  const markdown = normaliseText(toMarkdown(content))
  const text = normaliseText(markdown.replace(/^#{1,6}\s+/gm, '').replace(/^- /gm, '・'))

  return {
    id: shortHash(ref + text.slice(0, 512)),
    title: docTitle,
    origin: { kind: 'html', ref },
    text,
    sections: splitMarkdownSections(markdown).map((section) => ({
      ...section,
      text: normaliseText(section.text.replace(/^- /gm, '・')),
    })),
    meta: htmlLangAttr ? { ...meta, htmlLang: htmlLangAttr } : meta,
    charCount: charCount(text),
    lang: htmlLangAttr?.slice(0, 2) || detectLang(text),
  }
}
