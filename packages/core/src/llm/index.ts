import { configError } from '../errors.js'
import { DEFAULT_MODEL as ANTHROPIC_MODEL, anthropic } from './anthropic.js'
import { DEFAULT_MODEL as CLAUDE_CODE_MODEL, claudeCode } from './claude-code.js'
import { DEFAULT_MODEL as OLLAMA_MODEL, ollama, ollamaHost } from './ollama.js'
import { DEFAULT_BASE as OPENAI_BASE, DEFAULT_MODEL as OPENAI_MODEL, openai } from './openai.js'
import type { LLM, ProviderId, ProviderOptions } from './types.js'

export { anthropic } from './anthropic.js'
export { claudeCode } from './claude-code.js'
export { extractJson, structuredViaPrompt } from './json.js'
export { ollama } from './ollama.js'
export { openai } from './openai.js'
export * from './types.js'

const FACTORIES: Record<ProviderId, (options: ProviderOptions) => LLM> = {
  anthropic,
  openai,
  ollama,
  'claude-code': claudeCode,
}

export const PROVIDERS = Object.keys(FACTORIES) as ProviderId[]

/**
 * Pick a provider without being told: whichever credential is present wins,
 * with the local option last so a laptop with Ollama running still prefers a
 * configured API key.
 *
 * Ollama needs no credential, so there is nothing to find in the environment
 * unless the reader pointed `OLLAMA_HOST` somewhere — which is a clear enough
 * statement of intent to act on. A daemon on the default port stays opt-in:
 * guessing would mean a blocking probe on every run.
 */
export function detectProvider(): ProviderId | undefined {
  const configured = process.env.ANKOU_PROVIDER as ProviderId | undefined
  if (configured && configured in FACTORIES) return configured
  if (process.env.ANTHROPIC_API_KEY) return 'anthropic'
  if (process.env.OPENAI_API_KEY) return 'openai'
  if (process.env.OLLAMA_HOST) return 'ollama'
  return undefined
}

export interface ProviderStatus {
  id: ProviderId
  /** The model used when none is named. */
  defaultModel: string
  /** What this provider needs before it will work. */
  requires: string
  /** Usable right now, as far as can be told without spending a token. */
  ready: boolean
  /** What is missing, when something is. */
  blocker?: string
}

/**
 * Report what each provider needs and whether it looks satisfied.
 *
 * This is the answer to "I have no API key, now what": Ollama is probed rather
 * than assumed, because a daemon that is installed but not running is exactly
 * the case a reader cannot diagnose from the outside.
 */
export async function providerStatus(): Promise<ProviderStatus[]> {
  const [ollamaUp, sdkPresent] = await Promise.all([reachable(ollamaHost()), claudeCodeInstalled()])
  const openAiKey = process.env.OPENAI_API_KEY
  const openAiBase = process.env.OPENAI_BASE_URL ?? OPENAI_BASE

  return [
    {
      id: 'anthropic',
      defaultModel: ANTHROPIC_MODEL,
      requires: 'ANTHROPIC_API_KEY',
      ready: Boolean(process.env.ANTHROPIC_API_KEY),
      ...(process.env.ANTHROPIC_API_KEY ? {} : { blocker: 'ANTHROPIC_API_KEY is not set' }),
    },
    {
      id: 'openai',
      defaultModel: OPENAI_MODEL,
      requires: 'OPENAI_API_KEY, or --base-url for a local server',
      // Local servers accept any key, so a redirected base URL is enough.
      ready: Boolean(openAiKey) || !openAiBase.includes('api.openai.com'),
      ...(openAiKey || !openAiBase.includes('api.openai.com')
        ? {}
        : { blocker: 'OPENAI_API_KEY is not set' }),
    },
    {
      id: 'ollama',
      defaultModel: OLLAMA_MODEL,
      requires: `a daemon at ${ollamaHost()}`,
      ready: ollamaUp,
      ...(ollamaUp ? {} : { blocker: 'not answering — start it with `ollama serve`' }),
    },
    {
      id: 'claude-code',
      defaultModel: CLAUDE_CODE_MODEL,
      requires: 'the @anthropic-ai/claude-agent-sdk package and a Claude Code subscription',
      ready: sdkPresent,
      ...(sdkPresent ? {} : { blocker: 'run `npm i @anthropic-ai/claude-agent-sdk`' }),
    },
  ]
}

async function reachable(host: string): Promise<boolean> {
  try {
    const response = await fetch(`${host}/api/tags`, { signal: AbortSignal.timeout(1500) })
    return response.ok
  } catch {
    return false
  }
}

async function claudeCodeInstalled(): Promise<boolean> {
  try {
    await import('@anthropic-ai/claude-agent-sdk')
    return true
  } catch {
    return false
  }
}

export function createLLM(provider: ProviderId, options: ProviderOptions = {}): LLM {
  const factory = FACTORIES[provider]
  if (!factory) {
    throw configError(
      `Unknown provider \`${provider}\`.`,
      `Known providers: ${PROVIDERS.join(', ')}.`,
    )
  }
  return factory(options)
}

/**
 * Structured generation that works whether or not the provider implements it
 * natively — every call site in ankou goes through here.
 */
export async function ask<T>(
  llm: LLM,
  request: import('./types.js').StructuredRequest<T>,
): Promise<T> {
  if (llm.structured) return llm.structured<T>(request)
  const { structuredViaPrompt } = await import('./json.js')
  return structuredViaPrompt<T>(llm, request)
}
