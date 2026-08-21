export interface ParsedArgs {
  command?: string
  positionals: string[]
  flags: Record<string, string | boolean | string[]>
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
])

const REPEATABLE = new Set(['param'])

export function parseArgs(argv: string[]): ParsedArgs {
  const positionals: string[] = []
  const flags: Record<string, string | boolean | string[]> = {}
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
      if (inlineValue !== undefined) set(name, inlineValue)
      else if (VALUED.has(name)) {
        set(name, argv[index + 1] ?? '')
        index += 1
      } else if (name.startsWith('no-')) set(name.slice(3), false)
      else set(name, true)
    } else if (token.startsWith('-') && token.length > 1) {
      for (const [position, letter] of [...token.slice(1)].entries()) {
        const name = ALIASES[letter] ?? letter
        const isLast = position === token.length - 2
        if (VALUED.has(name) && isLast) {
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

  return { positionals, flags }
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
