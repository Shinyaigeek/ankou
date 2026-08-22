import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

export interface KamuConfig {
  provider?: string
  model?: string
  baseUrl?: string
  renderer?: string
  theme?: string
  open?: boolean
  outDir?: string
  windowChars?: number
}

export function configPath(): string {
  const base = process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config')
  return join(base, 'kamu', 'config.json')
}

const KEYS: (keyof KamuConfig)[] = [
  'provider',
  'model',
  'baseUrl',
  'renderer',
  'theme',
  'open',
  'outDir',
  'windowChars',
]

export interface LoadedConfig {
  config: KamuConfig
  /** What was wrong with the file. Reported, not fatal — see `loadConfig`. */
  problems: string[]
}

/** The known setting a mistyped one probably meant, if any is close enough. */
function nearestKey(name: string): string | undefined {
  let best: string | undefined
  let bestScore = Math.min(3, Math.ceil(name.length / 2))
  for (const candidate of KEYS) {
    const score = distance(name.toLowerCase(), candidate.toLowerCase())
    if (score < bestScore) {
      best = candidate
      bestScore = score
    }
  }
  return best
}

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

/**
 * Settings resolve flags > environment > config file > defaults, so a config
 * file is a convenience and never a surprise.
 *
 * Which is why a broken one has to say so. A missing file is silence by design;
 * a file that will not parse, or a setting nobody defined, used to be the same
 * silence — and the run then failed somewhere else entirely, complaining about
 * the environment while the reader's own configuration sat there being ignored.
 */
export async function loadConfig(): Promise<LoadedConfig> {
  let raw: string
  try {
    raw = await readFile(configPath(), 'utf8')
  } catch {
    return { config: {}, problems: [] }
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (cause) {
    return {
      config: {},
      problems: [`${configPath()} is not valid JSON: ${(cause as Error).message}`],
    }
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { config: {}, problems: [`${configPath()} should hold a JSON object.`] }
  }

  const problems: string[] = []
  for (const key of Object.keys(parsed)) {
    if ((KEYS as string[]).includes(key)) continue
    const guess = nearestKey(key)
    problems.push(
      `${configPath()} has no setting \`${key}\`${guess ? ` — did you mean \`${guess}\`?` : '.'}`,
    )
  }
  return { config: parsed as KamuConfig, problems }
}
