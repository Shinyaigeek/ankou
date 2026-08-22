import { configError, llmError } from '../errors.js'
import { structuredViaPrompt } from './json.js'
import type {
  ClaudeAgentSdk,
  CompleteRequest,
  LLM,
  ProviderOptions,
  StructuredRequest,
} from './types.js'

export const DEFAULT_MODEL = 'claude-sonnet-5'

interface AssistantMessage {
  type: 'assistant'
  message?: { content?: { type: string; text?: string }[] }
}

interface ResultMessage {
  type: 'result'
  subtype: string
  result?: unknown
}

/**
 * Run generation through the Claude Agent SDK, which authenticates with a
 * Claude Code subscription instead of an API key.
 *
 * The SDK is an optional peer dependency and is imported lazily, so users who
 * only ever use API providers never pay for it. Tools are disabled and the turn
 * limit is low: we want a completion, not an agent loop.
 */
export function claudeCode(options: ProviderOptions = {}): LLM {
  const model = options.model ?? process.env.KAMU_MODEL ?? DEFAULT_MODEL

  const load = async (): Promise<ClaudeAgentSdk> => {
    if (options.sdk) return options.sdk
    try {
      return (await import('@anthropic-ai/claude-agent-sdk')) as unknown as ClaudeAgentSdk
    } catch {
      throw configError(
        'The claude-code provider requires the optional `@anthropic-ai/claude-agent-sdk` package.',
        'Install it with `npm i @anthropic-ai/claude-agent-sdk`, or use `--provider anthropic` with an API key.',
      )
    }
  }

  const run = async (request: CompleteRequest): Promise<string> => {
    const sdk = await load()

    const conversation = sdk.query({
      prompt: request.prompt,
      options: {
        model,
        maxTurns: 4,
        allowedTools: [],
        permissionMode: 'default',
        ...(request.system ? { systemPrompt: request.system } : {}),
        ...(request.signal ? { abortController: toController(request.signal) } : {}),
      },
    })

    let text = ''
    for await (const raw of conversation) {
      const message = raw as { type?: string }
      if (message.type === 'assistant') {
        for (const block of (message as AssistantMessage).message?.content ?? []) {
          if (block.type === 'text') text += block.text ?? ''
        }
      }
      if (message.type === 'result') {
        const result = message as ResultMessage
        // A turn-limit result still carries the assistant text we asked for, so
        // only a run that produced nothing at all is an error.
        if (result.subtype !== 'success' && !text) {
          throw llmError(
            `Claude Code returned ${result.subtype}.`,
            'Check `claude` is installed and logged in with an active subscription.',
          )
        }
        return typeof result.result === 'string' && result.result ? result.result : text
      }
    }
    if (!text) throw llmError('Claude Code produced no output.')
    return text
  }

  return {
    name: `claude-code:${model}`,
    complete: run,
    async structured<T>(request: StructuredRequest<T>): Promise<T> {
      return structuredViaPrompt(this as LLM, request)
    },
  }
}

function toController(signal: AbortSignal): AbortController {
  const controller = new AbortController()
  if (signal.aborted) controller.abort()
  else signal.addEventListener('abort', () => controller.abort(), { once: true })
  return controller
}
