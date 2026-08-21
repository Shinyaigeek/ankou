import { llmError } from '../errors.js'
import { validate } from '../schema/validate.js'
import type { JsonSchema, LLM, StructuredRequest } from './types.js'

/** Pull the first balanced JSON object or array out of a model response. */
export function extractJson(raw: string): string | null {
  const fenced = /```(?:json)?\s*\n([\s\S]*?)```/i.exec(raw)
  const text = fenced ? fenced[1]! : raw

  const start = text.search(/[{[]/)
  if (start === -1) return null

  let depth = 0
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
    else if (ch === '{' || ch === '[') depth++
    else if (ch === '}' || ch === ']') {
      depth--
      if (depth === 0) return text.slice(start, i + 1)
    }
  }
  return null
}

function schemaPrompt(prompt: string, schema: JsonSchema): string {
  return `${prompt}

Reply with a single JSON value and nothing else. No prose, no code fence, no trailing commentary.
It must validate against this JSON Schema:

${JSON.stringify(schema, null, 2)}`
}

/**
 * Structured output for providers without native tool use: ask for JSON, parse
 * it, validate it, and give the model its own errors back once before failing.
 */
export async function structuredViaPrompt<T>(llm: LLM, request: StructuredRequest<T>): Promise<T> {
  const attempt = async (prompt: string): Promise<{ value?: T; errors: string[] }> => {
    const raw = await llm.complete({ ...request, prompt })
    const json = extractJson(raw)
    if (!json) return { errors: ['The reply contained no JSON value.'] }
    let parsed: unknown
    try {
      parsed = JSON.parse(json)
    } catch (cause) {
      return { errors: [`The JSON did not parse: ${(cause as Error).message}`] }
    }
    const errors = validate(parsed, request.schema)
    return errors.length > 0 ? { errors } : { value: parsed as T, errors: [] }
  }

  const first = await attempt(schemaPrompt(request.prompt, request.schema))
  if (first.value !== undefined) return first.value

  const retry = await attempt(
    `${schemaPrompt(request.prompt, request.schema)}

A previous attempt failed with:
${first.errors.map((error) => `- ${error}`).join('\n')}

Fix those problems and return the corrected JSON.`,
  )
  if (retry.value !== undefined) return retry.value

  throw llmError(
    `${llm.name} did not return valid \`${request.name}\` JSON after two attempts.`,
    retry.errors.slice(0, 5).join('; '),
  )
}
