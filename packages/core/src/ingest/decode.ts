import { ingestError } from '../errors.js'

/**
 * Turn bytes into text without guessing.
 *
 * Getting this wrong is not a cosmetic failure. A Shift_JIS page decoded as
 * UTF-8 becomes mojibake, `detectLang` then reads it as English, and the whole
 * run — prompts, pacing, ruby — is spent on garbage in the wrong language. So
 * every declaration the source actually makes is honoured, and a source that
 * makes none and is not UTF-8 is refused rather than mangled.
 */

const BOMS: [bytes: number[], label: string][] = [
  [[0xef, 0xbb, 0xbf], 'utf-8'],
  [[0xff, 0xfe], 'utf-16le'],
  [[0xfe, 0xff], 'utf-16be'],
]

/** A byte-order mark is the one declaration that outranks every other. */
export function charsetFromBom(bytes: Uint8Array): string | undefined {
  for (const [prefix, label] of BOMS) {
    if (prefix.every((byte, index) => bytes[index] === byte)) return label
  }
  return undefined
}

/** `charset=` out of a Content-Type, from a header or a meta tag. */
export function charsetFromContentType(value: string): string | undefined {
  return /charset\s*=\s*["']?([\w:.+-]+)/i.exec(value)?.[1]?.toLowerCase()
}

/**
 * The charset an HTML document declares about itself.
 *
 * Only the head matters and only ASCII is needed to read it, so the sniff runs
 * over the first bytes as latin1 — which never fails, whatever the real
 * encoding turns out to be.
 */
export function charsetFromMeta(bytes: Uint8Array): string | undefined {
  const head = Buffer.from(bytes.subarray(0, 2048)).toString('latin1')
  const meta = /<meta\b[^>]*>/gi
  for (const [tag] of head.matchAll(meta)) {
    const direct = /\bcharset\s*=\s*["']?([\w:.+-]+)/i.exec(tag)
    if (/http-equiv\s*=\s*["']?content-type/i.test(tag)) {
      const fromContent = charsetFromContentType(tag)
      if (fromContent) return fromContent
    } else if (direct?.[1] && !/http-equiv/i.test(tag)) {
      return direct[1].toLowerCase()
    }
  }
  return undefined
}

function decodeWith(bytes: Uint8Array, label: string, ref: string): string {
  let decoder: TextDecoder
  try {
    // `ignoreBOM: false` means the decoder drops a leading BOM for us.
    decoder = new TextDecoder(label, { fatal: false, ignoreBOM: false })
  } catch {
    throw ingestError(
      `${ref} declares an encoding this platform does not know: \`${label}\`.`,
      'Convert it to UTF-8 first, or pass a `encoding` this Node build supports.',
    )
  }
  return decoder.decode(bytes)
}

export interface DecodeOptions {
  /** What the caller knows, and what beats everything but a BOM. */
  declared?: string
  /** What the transport said, e.g. an HTTP Content-Type. */
  transport?: string
  /** Look for a `<meta charset>` declaration in the bytes. */
  html?: boolean
}

/**
 * Decode source bytes, honouring every declaration in order of authority:
 * a BOM, then the caller, then the transport, then the document itself.
 *
 * With no declaration anywhere, UTF-8 is assumed but not forced: bytes that are
 * not valid UTF-8 have an encoding nobody wrote down, and quietly turning them
 * into replacement characters would hide that for the rest of the run.
 */
export function decodeBytes(bytes: Uint8Array, ref: string, options: DecodeOptions = {}): string {
  const declared =
    charsetFromBom(bytes) ??
    options.declared?.toLowerCase() ??
    (options.transport ? charsetFromContentType(options.transport) : undefined) ??
    (options.html ? charsetFromMeta(bytes) : undefined)

  if (declared) return decodeWith(bytes, declared, ref)

  try {
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes)
  } catch {
    throw ingestError(
      `${ref} is not valid UTF-8, and nothing in it says what encoding it is.`,
      'Pass the encoding (CLI: `--encoding shift_jis`), or convert the file first: `iconv -f shift_jis -t utf-8`.',
    )
  }
}
