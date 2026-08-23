import type { JsonSchema } from '../llm/types.js'

/**
 * A deliberately small JSON Schema validator.
 *
 * ankou authors every schema it validates against, so this covers exactly the
 * keywords those schemas use. Its job is to catch a model that drifted from the
 * shape and to describe the drift well enough that the model can fix it, not to
 * be a general-purpose validator.
 */
export function validate(value: unknown, schema: JsonSchema, path = '$'): string[] {
  const errors: string[] = []

  const typeOf = (input: unknown): string => {
    if (input === null) return 'null'
    if (Array.isArray(input)) return 'array'
    if (Number.isInteger(input)) return 'integer'
    return typeof input
  }

  if (schema.type) {
    const allowed = Array.isArray(schema.type) ? schema.type : [schema.type]
    const actual = typeOf(value)
    const ok = allowed.some(
      (type) => type === actual || (type === 'number' && actual === 'integer'),
    )
    if (!ok) {
      errors.push(`${path}: expected ${allowed.join(' or ')}, got ${actual}`)
      return errors
    }
  }

  if (schema.enum && !schema.enum.some((option) => option === value)) {
    errors.push(
      `${path}: expected one of ${JSON.stringify(schema.enum)}, got ${JSON.stringify(value)}`,
    )
  }

  if (schema.const !== undefined && value !== schema.const) {
    errors.push(`${path}: expected ${JSON.stringify(schema.const)}`)
  }

  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) {
      errors.push(`${path}: must be >= ${schema.minimum}`)
    }
    if (schema.maximum !== undefined && value > schema.maximum) {
      errors.push(`${path}: must be <= ${schema.maximum}`)
    }
  }

  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) {
      errors.push(`${path}: needs at least ${schema.minItems} items, got ${value.length}`)
    }
    if (schema.maxItems !== undefined && value.length > schema.maxItems) {
      errors.push(`${path}: allows at most ${schema.maxItems} items, got ${value.length}`)
    }
    if (schema.items) {
      value.forEach((item, index) => {
        errors.push(...validate(item, schema.items!, `${path}[${index}]`))
      })
    }
  }

  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const record = value as Record<string, unknown>
    for (const key of schema.required ?? []) {
      if (record[key] === undefined) errors.push(`${path}.${key}: required property is missing`)
    }
    for (const [key, subSchema] of Object.entries(schema.properties ?? {})) {
      if (record[key] !== undefined) {
        errors.push(...validate(record[key], subSchema, `${path}.${key}`))
      }
    }
  }

  return errors.slice(0, 20)
}

/** Convenience helpers so format schemas read as data, not as boilerplate. */
export const S = {
  string: (description?: string, extra: JsonSchema = {}): JsonSchema => ({
    type: 'string',
    ...(description ? { description } : {}),
    ...extra,
  }),
  number: (description?: string, extra: JsonSchema = {}): JsonSchema => ({
    type: 'number',
    ...(description ? { description } : {}),
    ...extra,
  }),
  integer: (description?: string, extra: JsonSchema = {}): JsonSchema => ({
    type: 'integer',
    ...(description ? { description } : {}),
    ...extra,
  }),
  enum: (values: string[], description?: string): JsonSchema => ({
    type: 'string',
    enum: values,
    ...(description ? { description } : {}),
  }),
  array: (items: JsonSchema, description?: string, extra: JsonSchema = {}): JsonSchema => ({
    type: 'array',
    items,
    ...(description ? { description } : {}),
    ...extra,
  }),
  object: (
    properties: Record<string, JsonSchema>,
    required: string[],
    description?: string,
  ): JsonSchema => ({
    type: 'object',
    properties,
    required,
    additionalProperties: false,
    ...(description ? { description } : {}),
  }),
}
