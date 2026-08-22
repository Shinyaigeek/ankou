export interface CompleteRequest {
  system?: string
  prompt: string
  maxTokens?: number
  temperature?: number
  signal?: AbortSignal
}

export interface StructuredRequest<T = unknown> extends CompleteRequest {
  /** JSON Schema describing the object we want back. */
  schema: JsonSchema
  /** Name of the shape, used as the tool name where the provider supports it. */
  name: string
  /** Narrowing hook for callers that want a typed result without a cast. */
  __type?: T
}

export interface JsonSchema {
  type?: string | string[]
  description?: string
  properties?: Record<string, JsonSchema>
  required?: string[]
  items?: JsonSchema
  enum?: unknown[]
  const?: unknown
  minimum?: number
  maximum?: number
  minItems?: number
  maxItems?: number
  additionalProperties?: boolean | JsonSchema
  [key: string]: unknown
}

/**
 * The whole surface kamu needs from a model. Implement this to plug in any
 * provider — the pipeline never touches a vendor SDK directly.
 */
export interface LLM {
  /** Human-readable identity, e.g. `anthropic:claude-opus-5`. */
  readonly name: string
  complete(request: CompleteRequest): Promise<string>
  /** Optional native structured output; falls back to prompt-and-parse. */
  structured?<T>(request: StructuredRequest<T>): Promise<T>
}

export interface ProviderOptions {
  model?: string
  apiKey?: string
  baseUrl?: string
  maxTokens?: number
  temperature?: number
  /** Custom fetch, for tests or proxies. */
  fetchImpl?: typeof fetch
  /** Extra headers merged into every request. */
  headers?: Record<string, string>
  /**
   * Claude Agent SDK module for the `claude-code` provider — what `fetchImpl` is
   * for the HTTP providers. Left unset, the SDK is imported lazily from the
   * optional peer dependency.
   */
  sdk?: ClaudeAgentSdk
}

/** The sliver of the Claude Agent SDK the `claude-code` provider uses. */
export interface ClaudeAgentSdk {
  query(params: { prompt: string; options?: Record<string, unknown> }): AsyncIterable<unknown>
}

export type ProviderId = 'anthropic' | 'openai' | 'ollama' | 'claude-code'
