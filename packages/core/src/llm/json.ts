import { llmError } from '../errors.js'
import { validate } from '../schema/validate.js'
import type { JsonSchema, LLM, StructuredRequest } from './types.js'

/**
 * Walk a JSON fragment and report where it ended up: balanced at `end`, or
 * still inside `stack` levels of nesting because the text ran out.
 */
function scan(text: string, start: number): { end: number; stack: string[]; inString: boolean } {
  const stack: string[] = []
  let inString = false
  let escaped = false

  for (let i = start; i < text.length; i++) {
    const ch = text[i]!
    if (inString) {
      if (escaped) escaped = false
      else if (ch === '\\') escaped = true
      else if (ch === '"') inString = false
      continue
    }
    if (ch === '"') inString = true
    else if (ch === '{' || ch === '[') stack.push(ch)
    else if (ch === '}' || ch === ']') {
      stack.pop()
      if (stack.length === 0) return { end: i + 1, stack, inString: false }
    }
  }
  return { end: -1, stack, inString }
}

/**
 * Close a fragment a model cut short mid-value.
 *
 * Small local models run out of tokens in the middle of a long array far more
 * often than they emit malformed JSON, and throwing away 90% of a good reply
 * because its tail is missing is worse than keeping the part that arrived. So
 * the tail is trimmed back to the last element boundary, the open structures are
 * closed, and the result only counts if it actually parses.
 */
function closeTruncated(text: string, start: number): string | null {
  const MAX_TRIMS = 64
  let fragment = text.slice(start)

  for (let attempt = 0; attempt <= MAX_TRIMS; attempt++) {
    const state = scan(fragment, 0)
    if (state.stack.length > 0) {
      const body = (state.inString ? `${fragment}"` : fragment).replace(/[\s,:]+$/, '')
      const closers = state.stack
        .map((open) => (open === '{' ? '}' : ']'))
        .reverse()
        .join('')
      const candidate = body + closers
      try {
        const parsed: unknown = JSON.parse(candidate)
        // A fragment that recovers nothing — `{` closed into `{}` — is not a
        // repair, it is an empty answer wearing the right brackets.
        if (Object.keys(parsed as object).length > 0) return candidate
        return null
      } catch {
        // Cut back past the last element boundary and try again.
      }
    }
    const comma = fragment.lastIndexOf(',')
    if (comma <= 0) return null
    fragment = fragment.slice(0, comma)
  }
  return null
}

/**
 * Pull the first balanced JSON object or array out of a model response.
 *
 * A reply that was cut off before it closed is repaired rather than rejected —
 * see `closeTruncated`.
 */
export function extractJson(raw: string): string | null {
  const fenced = /```(?:json)?\s*\n([\s\S]*?)```/i.exec(raw)
  const text = fenced ? fenced[1]! : raw

  const start = text.search(/[{[]/)
  if (start === -1) return null

  const { end } = scan(text, start)
  if (end !== -1) return text.slice(start, end)
  return closeTruncated(text, start)
}

export interface StructuredAttempt<T> {
  /** Present only when the reply parsed *and* matched the schema. */
  value?: T
  /** What went wrong, phrased for the model that has to fix it. */
  errors: string[]
}

/** Check an already-decoded value — a tool-use input, say — against the schema. */
export function checkValue<T>(value: unknown, schema: JsonSchema): StructuredAttempt<T> {
  const errors = validate(value, schema)
  return errors.length > 0 ? { errors } : { value: value as T, errors: [] }
}

/** Decode a raw model reply and check it against the schema, in one step. */
export function parseAndValidate<T>(raw: string, schema: JsonSchema): StructuredAttempt<T> {
  const json = extractJson(raw)
  if (!json) return { errors: ['The reply contained no JSON value.'] }
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch (cause) {
    return { errors: [`The JSON did not parse: ${(cause as Error).message}`] }
  }
  return checkValue<T>(parsed, schema)
}

function schemaPrompt(prompt: string, schema: JsonSchema, priorErrors: string[]): string {
  const base = `${prompt}

Reply with a single JSON value and nothing else. No prose, no code fence, no trailing commentary.
It must validate against this JSON Schema:

${JSON.stringify(schema, null, 2)}`
  if (priorErrors.length === 0) return base
  return `${base}

A previous attempt failed with:
${priorErrors.map((error) => `- ${error}`).join('\n')}

Fix those problems and return the corrected JSON.`
}

/**
 * Structured output for providers without native tool use: ask for JSON, parse
 * it, validate it, and give the model its own errors back once before failing.
 *
 * `priorErrors` lets a provider that *does* have a native path hand over what it
 * already learned, so a near-miss is repaired instead of started from scratch.
 */
export async function structuredViaPrompt<T>(
  llm: LLM,
  request: StructuredRequest<T>,
  priorErrors: string[] = [],
): Promise<T> {
  const attempt = async (errors: string[]): Promise<StructuredAttempt<T>> => {
    const raw = await llm.complete({
      ...request,
      prompt: schemaPrompt(request.prompt, request.schema, errors),
    })
    return parseAndValidate<T>(raw, request.schema)
  }

  const first = await attempt(priorErrors)
  if (first.value !== undefined) return first.value

  const retry = await attempt(first.errors)
  if (retry.value !== undefined) return retry.value

  throw llmError(
    `${llm.name} did not return valid \`${request.name}\` JSON after two attempts.`,
    retry.errors.slice(0, 5).join('; '),
  )
}
