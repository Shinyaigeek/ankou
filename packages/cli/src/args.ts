export interface ParsedArgs {
  command?: string
  positionals: string[]
  flags: Record<string, string | boolean | string[]>
  /** Flags nobody defined. Reported rather than obeyed — see `parseArgs`. */
  unknown: string[]
}

const ALIASES: Record<string, string> = {
  i: 'intent',
  f: 'format',
  r: 'render',
  o: 'out',
  p: 'provider',
  m: 'model',
  h: 'help',
  v: 'version',
  q: 'quiet',
}

/** Flags that take a value; everything else is boolean. */
const VALUED = new Set([
  'intent',
  'format',
  'render',
  'out',
  'provider',
  'model',
  'base-url',
  'theme',
  'lang',
  'window',
  'param',
  'timeout',
  'encoding',
])

const BOOLEAN = new Set(['open', 'play', 'full', 'plan-only', 'quiet', 'help', 'version'])

const KNOWN = new Set([...VALUED, ...BOOLEAN])

const REPEATABLE = new Set(['param'])

/** How far apart two flag names are, for "did you mean". */
function distance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    let previous = row[0]!
    row[0] = i
    for (let j = 1; j <= b.length; j++) {
      const current = row[j]!
      row[j] = Math.min(row[j]! + 1, row[j - 1]! + 1, previous + (a[i - 1] === b[j - 1] ? 0 : 1))
      previous = current
    }
  }
  return row[b.length]!
}

/** The known flag a mistyped one probably meant, if any is close enough. */
export function nearestFlag(name: string): string | undefined {
  let best: string | undefined
  let bestScore = Math.min(3, Math.ceil(name.length / 2))
  for (const candidate of KNOWN) {
    const score = distance(name, candidate)
    if (score < bestScore) {
      best = candidate
      bestScore = score
    }
  }
  return best
}

/**
 * Parse the command line, and remember what it did not recognise.
 *
 * An unknown flag used to become a boolean nobody read, which is the quiet kind
 * of wrong: `--plan-onlyy` ran the full generation the reader was trying to
 * avoid, and `--forma quiz` turned `quiz` into a source file. Unknown names are
 * collected here and refused by the caller.
 */
export function parseArgs(argv: string[]): ParsedArgs {
  const positionals: string[] = []
  const flags: Record<string, string | boolean | string[]> = {}
  const unknown: string[] = []
  let index = 0

  const set = (name: string, value: string | boolean) => {
    if (REPEATABLE.has(name)) {
      const existing = flags[name]
      flags[name] = Array.isArray(existing) ? [...existing, String(value)] : [String(value)]
    } else {
      flags[name] = value
    }
  }

  while (index < argv.length) {
    const token = argv[index]!
    if (token === '--') {
      positionals.push(...argv.slice(index + 1))
      break
    }
    if (token.startsWith('--')) {
      const [rawName, inlineValue] = splitOnce(token.slice(2), '=')
      const name = ALIASES[rawName] ?? rawName
      const negated = name.startsWith('no-') ? name.slice(3) : name
      if (!KNOWN.has(negated)) unknown.push(`--${rawName}`)
      else if (inlineValue !== undefined) set(name, inlineValue)
      else if (VALUED.has(name)) {
        set(name, argv[index + 1] ?? '')
        index += 1
      } else if (name !== negated) set(negated, false)
      else set(name, true)
    } else if (token.startsWith('-') && token.length > 1) {
      for (const [position, letter] of [...token.slice(1)].entries()) {
        const name = ALIASES[letter] ?? letter
        const isLast = position === token.length - 2
        if (!KNOWN.has(name)) unknown.push(`-${letter}`)
        else if (VALUED.has(name) && isLast) {
          set(name, argv[index + 1] ?? '')
          index += 1
        } else {
          set(name, true)
        }
      }
    } else {
      positionals.push(token)
    }
    index += 1
  }

  return { positionals, flags, unknown }
}

function splitOnce(input: string, separator: string): [string, string | undefined] {
  const at = input.indexOf(separator)
  return at === -1 ? [input, undefined] : [input.slice(0, at), input.slice(at + 1)]
}

export function flagString(args: ParsedArgs, name: string): string | undefined {
  const value = args.flags[name]
  if (typeof value === 'string' && value !== '') return value
  return undefined
}

export function flagBool(args: ParsedArgs, name: string): boolean | undefined {
  const value = args.flags[name]
  return typeof value === 'boolean' ? value : undefined
}

export function flagList(args: ParsedArgs, name: string): string[] {
  const value = args.flags[name]
  if (Array.isArray(value)) return value
  if (typeof value === 'string') return [value]
  return []
}

/** `--param slideCount=12` → `{ slideCount: 12 }`, with numbers coerced. */
export function parseParams(entries: string[]): Record<string, unknown> {
  const params: Record<string, unknown> = {}
  for (const entry of entries) {
    const [key, raw] = splitOnce(entry, '=')
    if (!key || raw === undefined) continue
    if (raw === 'true' || raw === 'false') params[key] = raw === 'true'
    else if (raw !== '' && !Number.isNaN(Number(raw))) params[key] = Number(raw)
    else params[key] = raw
  }
  return params
}
