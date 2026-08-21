import { llmError } from '../errors.js'
import { validate } from '../schema/validate.js'
import { extractJson, structuredViaPrompt } from './json.js'
import type { CompleteRequest, LLM, ProviderOptions, StructuredRequest } from './types.js'

/** Local models through the Ollama daemon. No key, no cost, no network egress. */
export function ollama(options: ProviderOptions = {}): LLM {
  const model = options.model ?? process.env.KAMU_MODEL ?? 'qwen3:8b'
  const baseUrl = (options.baseUrl ?? process.env.OLLAMA_HOST ?? 'http://127.0.0.1:11434').replace(
    /\/$/,
    '',
  )
  const doFetch = options.fetchImpl ?? fetch

  const call = async (body: Record<string, unknown>, signal?: AbortSignal) => {
    let response: Response
    try {
      response = await doFetch(`${baseUrl}/api/chat`, {
        method: 'POST',
        signal,
        headers: { 'content-type': 'application/json', ...options.headers },
        body: JSON.stringify({ ...body, stream: false }),
      })
    } catch (cause) {
      throw llmError(
        `Cannot reach Ollama at ${baseUrl}: ${(cause as Error).message}`,
        'Start it with `ollama serve`, or point OLLAMA_HOST somewhere else.',
      )
    }
    if (!response.ok) {
      const detail = await response.text().catch(() => '')
      throw llmError(`Ollama returned HTTP ${response.status}.`, detail.slice(0, 400) || undefined)
    }
    return (await response.json()) as { message?: { content?: string } }
  }

  const messages = (request: CompleteRequest) => [
    ...(request.system ? [{ role: 'system', content: request.system }] : []),
    { role: 'user', content: request.prompt },
  ]

  return {
    name: `ollama:${model}`,

    async complete(request: CompleteRequest): Promise<string> {
      const result = await call(
        {
          model,
          messages: messages(request),
          options: {
            temperature: request.temperature ?? options.temperature ?? 0.4,
            num_predict: request.maxTokens ?? options.maxTokens ?? 8192,
          },
        },
        request.signal,
      )
      return result.message?.content ?? ''
    },

    async structured<T>(request: StructuredRequest<T>): Promise<T> {
      try {
        const result = await call(
          {
            model,
            messages: messages(request),
            format: { ...request.schema, type: 'object' },
            options: {
              temperature: request.temperature ?? options.temperature ?? 0.4,
              num_predict: request.maxTokens ?? options.maxTokens ?? 8192,
            },
          },
          request.signal,
        )
        const json = extractJson(result.message?.content ?? '')
        if (json) {
          const parsed = JSON.parse(json)
          if (validate(parsed, request.schema).length === 0) return parsed as T
        }
      } catch {
        // Older daemons reject a schema in `format`; prompt instead.
      }
      return structuredViaPrompt(this as LLM, request)
    },
  }
}
