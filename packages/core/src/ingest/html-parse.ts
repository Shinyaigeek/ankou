/**
 * A tiny, dependency-free HTML tokenizer and tree builder.
 *
 * kamu only needs enough structure to find the readable part of a page and turn
 * it into text, so this deliberately stops well short of a spec-compliant
 * parser: no scripting, no adoption agency, no namespaces. It is tolerant of
 * malformed markup because the input is arbitrary pages from the web.
 */

export interface ElementNode {
  type: 'element'
  tag: string
  attrs: Record<string, string>
  children: Node[]
  parent: ElementNode | null
}

export interface TextNode {
  type: 'text'
  value: string
  parent: ElementNode | null
}

export type Node = ElementNode | TextNode

const VOID = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'param',
  'source',
  'track',
  'wbr',
])

/** Elements whose content is raw text and must not be parsed as markup. */
const RAW_TEXT = new Set(['script', 'style', 'textarea', 'title'])

/** Elements that implicitly close an open element of the same kind. */
const AUTO_CLOSE: Record<string, string[]> = {
  li: ['li'],
  p: ['p'],
  dt: ['dt', 'dd'],
  dd: ['dt', 'dd'],
  tr: ['tr'],
  td: ['td', 'th'],
  th: ['td', 'th'],
  option: ['option'],
}

/**
 * HTML 4's Latin-1 entities are exactly codepoints 160–255, in order, so the
 * table is a list of names rather than 96 hand-typed pairs.
 */
const LATIN1 =
  'nbsp iexcl cent pound curren yen brvbar sect uml copy ordf laquo not shy reg macr deg plusmn sup2 sup3 acute micro para middot cedil sup1 ordm raquo frac14 frac12 frac34 iquest Agrave Aacute Acirc Atilde Auml Aring AElig Ccedil Egrave Eacute Ecirc Euml Igrave Iacute Icirc Iuml ETH Ntilde Ograve Oacute Ocirc Otilde Ouml times Oslash Ugrave Uacute Ucirc Uuml Yacute THORN szlig agrave aacute acirc atilde auml aring aelig ccedil egrave eacute ecirc euml igrave iacute icirc iuml eth ntilde ograve oacute ocirc otilde ouml divide oslash ugrave uacute ucirc uuml yacute thorn yuml'

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  // Typography and symbols outside Latin-1 that turn up constantly in prose.
  ensp: '\u2002',
  emsp: '\u2003',
  thinsp: '\u2009',
  zwnj: '\u200c',
  zwj: '\u200d',
  ndash: '–',
  mdash: '—',
  lsquo: '‘',
  rsquo: '’',
  sbquo: '‚',
  ldquo: '“',
  rdquo: '”',
  bdquo: '„',
  dagger: '†',
  Dagger: '‡',
  bull: '•',
  hellip: '…',
  permil: '‰',
  prime: '′',
  Prime: '″',
  lsaquo: '‹',
  rsaquo: '›',
  oline: '‾',
  frasl: '⁄',
  euro: '€',
  trade: '™',
  larr: '←',
  uarr: '↑',
  rarr: '→',
  darr: '↓',
  harr: '↔',
  minus: '−',
  lowast: '∗',
  ne: '≠',
  le: '≤',
  ge: '≥',
  infin: '∞',
  radic: '√',
  asymp: '≈',
  equiv: '≡',
  sum: '∑',
  prod: '∏',
  part: '∂',
  int: '∫',
  deg: '°',
}
for (const [index, name] of LATIN1.split(' ').entries()) {
  ENTITIES[name] = String.fromCodePoint(0xa0 + index)
}
// `&nbsp;` is a space as far as reading is concerned, not U+00A0 — every
// downstream measure of "how much text is this" would otherwise be off.
ENTITIES.nbsp = ' '
ENTITIES.shy = ''

/**
 * Names HTML allows shouted. The rest are case-sensitive on purpose: `&Eacute;`
 * and `&eacute;` are different letters, and folding them was quietly turning É
 * into é.
 */
const CASE_INSENSITIVE = new Set(['amp', 'lt', 'gt', 'quot', 'copy', 'reg', 'trade', 'nbsp'])

export function decodeEntities(input: string): string {
  return input.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/g, (whole, body: string) => {
    if (body.startsWith('#')) {
      const code =
        body[1] === 'x' || body[1] === 'X'
          ? Number.parseInt(body.slice(2), 16)
          : Number.parseInt(body.slice(1), 10)
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : whole
    }
    const lowered = body.toLowerCase()
    return (
      ENTITIES[body] ?? (CASE_INSENSITIVE.has(lowered) ? ENTITIES[lowered] : undefined) ?? whole
    )
  })
}

function parseAttrs(source: string): Record<string, string> {
  const attrs: Record<string, string> = {}
  const re = /([^\s"'>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s">]+)))?/g
  for (const match of source.matchAll(re)) {
    const name = match[1]!.toLowerCase()
    attrs[name] = decodeEntities(match[2] ?? match[3] ?? match[4] ?? '')
  }
  return attrs
}

/**
 * Find the `>` that closes a tag, skipping any inside quoted attribute values.
 *
 * Real pages put markup inside attributes — Wikipedia ships whole JSON blobs in
 * `data-mw` — and a naive `indexOf('>')` cuts the tag in half and spills the
 * attribute into the page as text.
 */
function findTagEnd(source: string, from: number): number {
  let quote: string | null = null
  for (let i = from; i < source.length; i++) {
    const char = source[i]!
    if (quote) {
      if (char === quote) quote = null
    } else if (char === '"' || char === "'") {
      quote = char
    } else if (char === '>') {
      return i
    }
  }
  return -1
}

export function parseHtml(html: string): ElementNode {
  const root: ElementNode = { type: 'element', tag: '#root', attrs: {}, children: [], parent: null }
  const stack: ElementNode[] = [root]
  const top = () => stack[stack.length - 1]!

  let i = 0
  const source = html.replace(/<!--[\s\S]*?-->/g, '')

  const pushText = (value: string) => {
    if (!value) return
    const parent = top()
    parent.children.push({ type: 'text', value: decodeEntities(value), parent })
  }

  while (i < source.length) {
    const lt = source.indexOf('<', i)
    if (lt === -1) {
      pushText(source.slice(i))
      break
    }
    pushText(source.slice(i, lt))

    const gt = findTagEnd(source, lt + 1)
    if (gt === -1) {
      pushText(source.slice(lt))
      break
    }
    const raw = source.slice(lt + 1, gt)
    i = gt + 1

    if (raw.startsWith('!') || raw.startsWith('?')) continue

    if (raw.startsWith('/')) {
      const tag = raw.slice(1).trim().toLowerCase()
      for (let d = stack.length - 1; d > 0; d--) {
        if (stack[d]!.tag === tag) {
          stack.length = d
          break
        }
      }
      continue
    }

    const nameMatch = /^([a-zA-Z][^\s/>]*)/.exec(raw)
    if (!nameMatch) continue
    const tag = nameMatch[1]!.toLowerCase()
    const attrs = parseAttrs(raw.slice(nameMatch[0].length))
    const selfClosing = raw.trimEnd().endsWith('/')

    for (const closable of AUTO_CLOSE[tag] ?? []) {
      if (top().tag === closable) stack.pop()
    }

    const node: ElementNode = { type: 'element', tag, attrs, children: [], parent: top() }
    top().children.push(node)

    if (VOID.has(tag) || selfClosing) continue

    if (RAW_TEXT.has(tag)) {
      const closeRe = new RegExp(`</${tag}\\s*>`, 'i')
      const rest = source.slice(i)
      const end = closeRe.exec(rest)
      const value = end ? rest.slice(0, end.index) : rest
      if (tag === 'title' || tag === 'textarea') {
        node.children.push({ type: 'text', value: decodeEntities(value), parent: node })
      }
      i += end ? end.index + end[0].length : rest.length
      continue
    }

    stack.push(node)
  }

  return root
}

export function walk(node: Node, visit: (node: Node) => void): void {
  visit(node)
  if (node.type === 'element') for (const child of node.children) walk(child, visit)
}

export function textOf(node: Node): string {
  if (node.type === 'text') return node.value
  if (node.tag === 'script' || node.tag === 'style') return ''
  return node.children.map(textOf).join('')
}

export function findAll(root: ElementNode, tag: string): ElementNode[] {
  const out: ElementNode[] = []
  walk(root, (node) => {
    if (node.type === 'element' && node.tag === tag) out.push(node)
  })
  return out
}

export function findFirst(root: ElementNode, tag: string): ElementNode | undefined {
  return findAll(root, tag)[0]
}
