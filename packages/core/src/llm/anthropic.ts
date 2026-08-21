import { configError, llmError } from '../errors.js'
import { validate } from '../schema/validate.js'
import { structuredViaPrompt } from './json.js'
import type { CompleteRequest, LLM, ProviderOptions, StructuredRequest } from './types.js'

const DEFAULT_MODEL = 'claude-sonnet-5'
const DEFAULT_BASE = 'https://api.anthropic.com'
const API_VERSION = '2023-06-01'

interface AnthropicContent {
  type: string
  text?: string
  input?: unknown
  name?: string
}

/**
 * Direct Messages API client over `fetch`. Deliberately not the vendor SDK:
 * kamu-core stays dependency-free so it drops into any Node 22 project.
 */
export function anthropic(options: ProviderOptions = {}): LLM {
  const apiKey = options.apiKey ?? process.env.ANTHROPIC_API_KEY
  const model = options.model ?? process.env.KAMU_MODEL ?? DEFAULT_MODEL
  const baseUrl = (options.baseUrl ?? process.env.ANTHROPIC_BASE_URL ?? DEFAULT_BASE).replace(
    /\/$/,
    '',
  )
  const doFetch = options.fetchImpl ?? fetch

  if (!apiKey) {
    throw configError(
      'The anthropic provider needs an API key.',
      'Set ANTHROPIC_API_KEY, or pass `{ provider: "claude-code" }` to use a Claude Code subscription instead.',
    )
  }

  const call = async (body: Record<string, unknown>, signal?: AbortSignal) => {
    const response = await doFetch(`${baseUrl}/v1/messages`, {
      method: 'POST',
      signal,
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': API_VERSION,
        ...options.headers,
      },
      body: JSON.stringify(body),
    })
    if (!response.ok) {
      const detail = await response.text().catch(() => '')
      throw llmError(
        `Anthropic API returned HTTP ${response.status}.`,
        detail.slice(0, 400) || undefined,
      )
    }
    return (await response.json()) as { content: AnthropicContent[]; stop_reason?: string }
  }

  return {
    name: `anthropic:${model}`,

    async complete(request: CompleteRequest): Promise<string> {
      const result = await call(
        {
          model,
          max_tokens: request.maxTokens ?? options.maxTokens ?? 8192,
          temperature: request.temperature ?? options.temperature ?? 0.4,
          ...(request.system ? { system: request.system } : {}),
          messages: [{ role: 'user', content: request.prompt }],
        },
        request.signal,
      )
      return result.content
        .filter((block) => block.type === 'text')
        .map((block) => block.text ?? '')
        .join('')
    },

    async structured<T>(request: StructuredRequest<T>): Promise<T> {
      // Tool use is the reliable path: the model fills a schema instead of
      // being asked politely to emit JSON.
      const result = await call(
        {
          model,
          max_tokens: request.maxTokens ?? options.maxTokens ?? 8192,
          temperature: request.temperature ?? options.temperature ?? 0.4,
          ...(request.system ? { system: request.system } : {}),
          messages: [{ role: 'user', content: request.prompt }],
          tools: [
            {
              name: request.name,
              description: `Return the ${request.name} result.`,
              input_schema: { ...request.schema, type: 'object' },
            },
          ],
          tool_choice: { type: 'tool', name: request.name },
        },
        request.signal,
      )
      const toolUse = result.content.find((block) => block.type === 'tool_use')
      if (!toolUse?.input) {
        return structuredViaPrompt(this as LLM, request)
      }
      const errors = validate(toolUse.input, request.schema)
      if (errors.length > 0) {
        throw llmError(
          `Anthropic returned a \`${request.name}\` object that does not match the schema.`,
          errors.slice(0, 5).join('; '),
        )
      }
      return toolUse.input as T
    },
  }
}
