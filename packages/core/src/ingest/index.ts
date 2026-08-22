import { readFile } from 'node:fs/promises'
import { basename, extname } from 'node:path'
import { ingestError } from '../errors.js'
import type { Document, Source, SourceKind } from '../types.js'
import { decodeBytes } from './decode.js'
import { documentFromHtml } from './html.js'
import { documentFromMarkdown } from './markdown.js'
import { documentFromPdf } from './pdf.js'
import { documentFromText } from './text.js'

export * from './decode.js'
export * from './html.js'
export * from './markdown.js'
export * from './pdf.js'
export * from './text.js'

const EXT_KIND: Record<string, SourceKind> = {
  '.md': 'markdown',
  '.markdown': 'markdown',
  '.mdx': 'markdown',
  '.txt': 'text',
  '.text': 'text',
  '.rst': 'text',
  '.org': 'text',
  '.html': 'html',
  '.htm': 'html',
  '.xhtml': 'html',
  '.pdf': 'pdf',
}

export function kindFromMime(mime: string): SourceKind | undefined {
  const type = mime.split(';')[0]!.trim().toLowerCase()
  if (type === 'application/pdf') return 'pdf'
  if (type === 'text/html' || type === 'application/xhtml+xml') return 'html'
  if (type === 'text/markdown') return 'markdown'
  if (type.startsWith('text/')) return 'text'
  return undefined
}

export function looksLikeUrl(value: string): boolean {
  return /^https?:\/\//i.test(value)
}

function kindFromPath(path: string): SourceKind {
  return EXT_KIND[extname(path).toLowerCase()] ?? 'text'
}

/** Content sniffing for inline strings with no filename to go on. */
export function kindFromContent(content: string): SourceKind {
  const head = content.slice(0, 2000)
  if (/^\s*(<!doctype html|<html|<head|<body)/i.test(head)) return 'html'
  if (/<(p|div|article|section|h[1-6])\b[^>]*>/i.test(head) && /<\/\w+>/.test(head)) return 'html'
  if (/^\s*#{1,6}\s|\n#{1,6}\s|\n[-*]\s|\[[^\]]+\]\([^)]+\)|^---\n/m.test(head)) return 'markdown'
  return 'text'
}

export interface IngestOptions {
  /** Custom fetch, for tests or for a proxy. */
  fetchImpl?: typeof fetch
  /** How long to wait for a URL before giving up. */
  timeoutMs?: number
  /** User agent sent when fetching URLs. */
  userAgent?: string
  /** Keep the entire page instead of extracting the readable part. */
  full?: boolean
  /** Character encoding for sources that declare none. A source's own wins. */
  encoding?: string
}

const DEFAULT_UA = 'kamu/0.1 (+https://github.com/Shinyaigeek/kamu) reader-bot'

/** Follow a `<meta http-equiv="refresh">` hop, which HTTP redirects do not cover. */
function metaRefreshTarget(html: string, base: string): string | undefined {
  const match =
    /<meta[^>]+http-equiv=["']?refresh["']?[^>]*content=["']?[^"'>]*url=([^"'>\s]+)/i.exec(html) ??
    /<meta[^>]+content=["']?[^"'>]*url=([^"'>\s]+)[^>]*http-equiv=["']?refresh/i.exec(html)
  if (!match?.[1]) return undefined
  try {
    return new URL(match[1].replace(/&amp;/g, '&'), base).toString()
  } catch {
    return undefined
  }
}

async function ingestUrl(
  url: string,
  options: IngestOptions,
  encoding: string | undefined,
  hop = 0,
): Promise<Document> {
  const doFetch = options.fetchImpl ?? fetch
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 30_000)
  try {
    const response = await doFetch(url, {
      redirect: 'follow',
      signal: controller.signal,
      headers: { 'user-agent': options.userAgent ?? DEFAULT_UA, accept: '*/*' },
    })
    if (!response.ok) {
      throw ingestError(`Fetching ${url} failed with HTTP ${response.status}.`)
    }
    const mime = response.headers.get('content-type') ?? ''
    const kind = kindFromMime(mime) ?? 'html'
    const name = new URL(url).hostname
    if (kind === 'pdf') {
      const bytes = new Uint8Array(await response.arrayBuffer())
      const document = await documentFromPdf(bytes, url, name)
      return { ...document, origin: { kind: 'url', ref: url } }
    }
    // `response.text()` is always UTF-8, whatever the page says it is.
    const body = decodeBytes(new Uint8Array(await response.arrayBuffer()), url, {
      ...(encoding ? { declared: encoding } : {}),
      transport: mime,
      html: kind === 'html',
    })

    if (kind === 'html' && hop < 2) {
      const target = metaRefreshTarget(body, url)
      if (target && target !== url) {
        clearTimeout(timer)
        return ingestUrl(target, options, encoding, hop + 1)
      }
    }

    const document =
      kind === 'markdown'
        ? documentFromMarkdown(body, url, name)
        : kind === 'text'
          ? documentFromText(body, url, name)
          : documentFromHtml(body, url, name, { full: options.full })
    return { ...document, origin: { kind: 'url' as const, ref: url } }
  } finally {
    clearTimeout(timer)
  }
}

/** Turn one source descriptor into a normalised `Document`. */
export async function ingest(source: Source, options: IngestOptions = {}): Promise<Document> {
  const descriptor =
    typeof source === 'string'
      ? looksLikeUrl(source)
        ? { url: source }
        : { path: source }
      : source

  const encoding = descriptor.encoding ?? options.encoding
  if (descriptor.url) return ingestUrl(descriptor.url, options, encoding)

  if (descriptor.content !== undefined) {
    const kind = descriptor.kind ?? kindFromContent(descriptor.content)
    const ref = descriptor.name ?? 'inline'
    if (kind === 'pdf') throw ingestError('Inline PDF content must be given as a path or URL.')
    if (kind === 'html')
      return documentFromHtml(descriptor.content, ref, descriptor.name, { full: options.full })
    if (kind === 'markdown') return documentFromMarkdown(descriptor.content, ref, descriptor.name)
    return documentFromText(descriptor.content, ref, descriptor.name)
  }

  if (!descriptor.path) throw ingestError('A source needs one of `path`, `url` or `content`.')

  const path = descriptor.path
  const kind = descriptor.kind ?? kindFromPath(path)
  const name = descriptor.name ?? basename(path)
  let bytes: Buffer
  try {
    bytes = await readFile(path)
  } catch (cause) {
    throw ingestError(`Cannot read ${path}: ${(cause as Error).message}`)
  }

  if (kind === 'pdf') return documentFromPdf(new Uint8Array(bytes), path, name)
  const content = decodeBytes(new Uint8Array(bytes), path, {
    ...(encoding ? { declared: encoding } : {}),
    html: kind === 'html',
  })
  // A path with an unhelpful extension still deserves a sniff.
  const resolved =
    descriptor.kind ?? EXT_KIND[extname(path).toLowerCase()] ?? kindFromContent(content)
  if (resolved === 'html') return documentFromHtml(content, path, name, { full: options.full })
  if (resolved === 'markdown') return documentFromMarkdown(content, path, name)
  return documentFromText(content, path, name)
}

export async function ingestAll(
  sources: Source[],
  options: IngestOptions = {},
): Promise<Document[]> {
  return Promise.all(sources.map((source) => ingest(source, options)))
}
