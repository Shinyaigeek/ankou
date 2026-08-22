/**
 * kamu — chew documents into the shape you actually want to read them in.
 *
 * ```ts
 * import { chewAndRender } from '@shinyaigeek/kamu-core'
 *
 * const { output } = await chewAndRender({
 *   sources: ['./spec.md', 'https://example.com/post'],
 *   intent: '一字一句漏らさず頭に入れたい',
 *   provider: 'anthropic',
 * })
 * await writeFile('out.html', output.content)
 * ```
 */

export {
  type ChewAndRenderOptions,
  type ChewOptions,
  type ChewPlanResult,
  type ChewResult,
  chew,
  chewAndRender,
  chewPlan,
} from './chew.js'
export { KamuError } from './errors.js'
export {
  type ComposeContext,
  FORMAT_IDS,
  FORMATS,
  type FormatModule,
  getFormat,
  isFormatId,
  isPiece,
} from './formats/index.js'
export {
  type IngestOptions,
  ingest,
  ingestAll,
  kindFromContent,
  kindFromMime,
  looksLikeUrl,
} from './ingest/index.js'
export {
  anthropic,
  ask,
  claudeCode,
  createLLM,
  detectProvider,
  ollama,
  openai,
  PROVIDERS,
  type ProviderStatus,
  providerStatus,
} from './llm/index.js'
export type {
  CompleteRequest,
  JsonSchema,
  LLM,
  ProviderId,
  ProviderOptions,
  StructuredRequest,
} from './llm/types.js'
export { documentTotalChars, guessFormat, type PlanOptions, plan } from './plan.js'
export {
  isRendererId,
  type PlayOptions,
  playTui,
  RENDERERS,
  render,
  renderHtml,
  renderTuiText,
  term,
} from './render/index.js'
export { S, validate } from './schema/validate.js'
export type * from './types.js'
export { graphemes, windows } from './util/text.js'
