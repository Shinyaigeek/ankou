import { llmError } from '../errors.js'
import { parseAndValidate, structuredViaPrompt } from './json.js'
import type { CompleteRequest, LLM, ProviderOptions, StructuredRequest } from './types.js'

/**
 * A non-2xx reply from the daemon, as opposed to not reaching it at all.
 *
 * The difference matters: a daemon that rejects a request can often be asked a
 * different way, whereas a daemon that is not there cannot, and quietly
 * degrading the second case into a retry only buys a worse error message later.
 */
class DaemonRejected extends Error {
  constructor(
    readonly status: number,
    readonly detail: string,
  ) {
    super(`Ollama returned HTTP ${status}.`)
    this.name = 'DaemonRejected'
  }
}

const asLlmError = (cause: unknown): unknown =>
  cause instanceof DaemonRejected
    ? llmError(cause.message, cause.detail.slice(0, 400) || undefined)
    : cause

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
      if (signal?.aborted) throw cause
      throw llmError(
        `Cannot reach Ollama at ${baseUrl}: ${(cause as Error).message}`,
        'Start it with `ollama serve`, or point OLLAMA_HOST somewhere else.',
      )
    }
    if (!response.ok) {
      throw new DaemonRejected(response.status, await response.text().catch(() => ''))
    }
    return (await response.json()) as { message?: { content?: string } }
  }

  const messages = (request: CompleteRequest) => [
    ...(request.system ? [{ role: 'system', content: request.system }] : []),
    { role: 'user', content: request.prompt },
  ]

  const tuning = (request: CompleteRequest) => ({
    temperature: request.temperature ?? options.temperature ?? 0.4,
    num_predict: request.maxTokens ?? options.maxTokens ?? 8192,
  })

  return {
    name: `ollama:${model}`,

    async complete(request: CompleteRequest): Promise<string> {
      try {
        const result = await call(
          { model, messages: messages(request), options: tuning(request) },
          request.signal,
        )
        return result.message?.content ?? ''
      } catch (cause) {
        throw asLlmError(cause)
      }
    },

    async structured<T>(request: StructuredRequest<T>): Promise<T> {
      let priorErrors: string[] = []
      try {
        const result = await call(
          {
            model,
            messages: messages(request),
            format: { ...request.schema, type: 'object' },
            options: tuning(request),
          },
          request.signal,
        )
        // The grammar keeps the shape honest but not the bounds, so a reply can
        // come back well-formed and still out of range. Carry those complaints
        // into the prompt path rather than starting the model over blind.
        const attempt = parseAndValidate<T>(result.message?.content ?? '', request.schema)
        if (attempt.value !== undefined) return attempt.value
        priorErrors = attempt.errors
      } catch (cause) {
        // Older daemons reject a schema in `format`; ask them in prose instead.
        // Anything else — no daemon, an aborted run — is a real failure.
        if (!(cause instanceof DaemonRejected)) throw cause
      }
      return structuredViaPrompt(this as LLM, request, priorErrors)
    },
  }
}
