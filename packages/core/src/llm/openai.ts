import { configError, llmError } from '../errors.js'
import { parseAndValidate, structuredViaPrompt } from './json.js'
import type { CompleteRequest, LLM, ProviderOptions, StructuredRequest } from './types.js'

/**
 * Any OpenAI-compatible `/chat/completions` endpoint: OpenAI itself, OpenRouter,
 * Together, LM Studio, vLLM, Groq. Point `baseUrl` at the server and go.
 */
export function openai(options: ProviderOptions = {}): LLM {
  const apiKey = options.apiKey ?? process.env.OPENAI_API_KEY
  const model = options.model ?? process.env.KAMU_MODEL ?? 'gpt-4.1'
  const baseUrl = (
    options.baseUrl ??
    process.env.OPENAI_BASE_URL ??
    'https://api.openai.com/v1'
  ).replace(/\/$/, '')
  const doFetch = options.fetchImpl ?? fetch

  // Local servers accept any key, so only complain for the hosted default.
  if (!apiKey && baseUrl.includes('api.openai.com')) {
    throw configError('The openai provider needs an API key.', 'Set OPENAI_API_KEY.')
  }

  const call = async (body: Record<string, unknown>, signal?: AbortSignal) => {
    const response = await doFetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      signal,
      headers: {
        'content-type': 'application/json',
        ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
        ...options.headers,
      },
      body: JSON.stringify(body),
    })
    if (!response.ok) {
      const detail = await response.text().catch(() => '')
      throw llmError(
        `OpenAI-compatible API returned HTTP ${response.status}.`,
        detail.slice(0, 400) || undefined,
      )
    }
    return (await response.json()) as {
      choices: { message: { content: string | null } }[]
    }
  }

  const messages = (request: CompleteRequest) => [
    ...(request.system ? [{ role: 'system', content: request.system }] : []),
    { role: 'user', content: request.prompt },
  ]

  return {
    name: `openai:${model}`,

    async complete(request: CompleteRequest): Promise<string> {
      const result = await call(
        {
          model,
          messages: messages(request),
          max_completion_tokens: request.maxTokens ?? options.maxTokens ?? 8192,
          temperature: request.temperature ?? options.temperature ?? 0.4,
        },
        request.signal,
      )
      return result.choices[0]?.message.content ?? ''
    },

    async structured<T>(request: StructuredRequest<T>): Promise<T> {
      let priorErrors: string[] = []
      try {
        const result = await call(
          {
            model,
            messages: messages(request),
            max_completion_tokens: request.maxTokens ?? options.maxTokens ?? 8192,
            temperature: request.temperature ?? options.temperature ?? 0.4,
            response_format: {
              type: 'json_schema',
              json_schema: {
                name: request.name,
                strict: false,
                schema: { ...request.schema, type: 'object' },
              },
            },
          },
          request.signal,
        )
        // `strict: false` buys compatibility with the many endpoints that only
        // approximate json_schema, at the cost of replies that fit the shape but
        // not the bounds. Hand those complaints to the prompt path to repair.
        const attempt = parseAndValidate<T>(
          result.choices[0]?.message.content ?? '',
          request.schema,
        )
        if (attempt.value !== undefined) return attempt.value
        priorErrors = attempt.errors
      } catch (cause) {
        // Endpoints that do not implement json_schema fall through to prompting;
        // an aborted run is not something to retry.
        if (request.signal?.aborted) throw cause
      }
      return structuredViaPrompt(this as LLM, request, priorErrors)
    },
  }
}
