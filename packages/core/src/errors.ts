export class KamuError extends Error {
  readonly code: string
  readonly hint?: string

  constructor(code: string, message: string, hint?: string) {
    super(message)
    this.name = 'KamuError'
    this.code = code
    this.hint = hint
  }
}

export const ingestError = (message: string, hint?: string) =>
  new KamuError('INGEST', message, hint)

export const llmError = (message: string, hint?: string) => new KamuError('LLM', message, hint)

export const composeError = (message: string, hint?: string) =>
  new KamuError('COMPOSE', message, hint)

export const configError = (message: string, hint?: string) =>
  new KamuError('CONFIG', message, hint)
