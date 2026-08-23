export class AnkouError extends Error {
  readonly code: string
  readonly hint?: string

  constructor(code: string, message: string, hint?: string) {
    super(message)
    this.name = 'AnkouError'
    this.code = code
    this.hint = hint
  }
}

export const ingestError = (message: string, hint?: string) =>
  new AnkouError('INGEST', message, hint)

export const llmError = (message: string, hint?: string) => new AnkouError('LLM', message, hint)

export const composeError = (message: string, hint?: string) =>
  new AnkouError('COMPOSE', message, hint)

export const configError = (message: string, hint?: string) =>
  new AnkouError('CONFIG', message, hint)
