import { configError } from '../errors.js'
import { anthropic } from './anthropic.js'
import { claudeCode } from './claude-code.js'
import { ollama } from './ollama.js'
import { openai } from './openai.js'
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
 */
export function detectProvider(): ProviderId | undefined {
  const configured = process.env.KAMU_PROVIDER as ProviderId | undefined
  if (configured && configured in FACTORIES) return configured
  if (process.env.ANTHROPIC_API_KEY) return 'anthropic'
  if (process.env.OPENAI_API_KEY) return 'openai'
  return undefined
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
 * natively — every call site in kamu goes through here.
 */
export async function ask<T>(
  llm: LLM,
  request: import('./types.js').StructuredRequest<T>,
): Promise<T> {
  if (llm.structured) return llm.structured<T>(request)
  const { structuredViaPrompt } = await import('./json.js')
  return structuredViaPrompt<T>(llm, request)
}
