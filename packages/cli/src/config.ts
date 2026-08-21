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

/**
 * Settings resolve flags > environment > config file > defaults, so a config
 * file is a convenience and never a surprise.
 */
export async function loadConfig(): Promise<KamuConfig> {
  try {
    const raw = await readFile(configPath(), 'utf8')
    const parsed = JSON.parse(raw) as KamuConfig
    return typeof parsed === 'object' && parsed !== null ? parsed : {}
  } catch {
    return {}
  }
}
