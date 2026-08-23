import {
  type CarveResult,
  carve,
  type FormatId,
  type LLM,
  type Piece,
  type Source,
  type StructuredRequest,
  validate,
} from 'ankou-core'

/**
 * A carve whose model is the host.
 *
 * ankou's pipeline is unchanged: it ingests, plans, windows and assembles
 * exactly as it does under an API provider. Only the thing on the other end of
 * `ask()` is different — instead of a `fetch` to a vendor, the request is handed
 * out over MCP and the run parks until an answer comes back. Which means the
 * answer can be written by something that just went and read the RFC the
 * document cites, and every structural guarantee still belongs to ankou: the
 * flipbook's body is still sliced from the source here, not typed by a model.
 */

export interface ModelRequest {
  name: string
  schema?: unknown
  system?: string
  prompt: string
}

interface Pending {
  request: ModelRequest
  resolve: (value: unknown) => void
  reject: (error: unknown) => void
}

export type Settled =
  | { kind: 'request'; request: ModelRequest; progress: string[] }
  | { kind: 'done'; result: CarveResult; progress: string[] }
  | { kind: 'error'; error: Error; progress: string[] }

class Job {
  pending?: Pending
  state: 'running' | 'done' | 'failed' = 'running'
  result?: CarveResult
  error?: Error
  progress: string[] = []
  readonly controller = new AbortController()
  readonly created = Date.now()
  /** Resolves whoever is waiting for the run to reach its next checkpoint. */
  wake?: () => void

  constructor(readonly id: string) {}

  notify(): void {
    const wake = this.wake
    this.wake = undefined
    wake?.()
  }

  /** The model, as far as ankou is concerned. */
  model(): LLM {
    return {
      name: 'mcp:host',
      complete: (request) =>
        this.hand({
          name: 'completion',
          prompt: request.prompt,
          ...(request.system ? { system: request.system } : {}),
        }) as Promise<string>,
      structured: <T>(request: StructuredRequest<T>) =>
        this.hand({
          name: request.name,
          schema: request.schema,
          prompt: request.prompt,
          ...(request.system ? { system: request.system } : {}),
        }) as Promise<T>,
    }
  }

  private hand(request: ModelRequest): Promise<unknown> {
    return new Promise((resolve, reject) => {
      this.pending = { request, resolve, reject }
      this.notify()
    })
  }

  /** Wait for the next thing worth telling the caller about. */
  async settle(): Promise<Settled> {
    if (!this.pending && this.state === 'running') {
      await new Promise<void>((resolve) => {
        this.wake = resolve
      })
    }
    const progress = this.progress.splice(0)
    if (this.pending) return { kind: 'request', request: this.pending.request, progress }
    if (this.state === 'done' && this.result) return { kind: 'done', result: this.result, progress }
    return {
      kind: 'error',
      error: this.error ?? new Error('the run stopped without a result'),
      progress,
    }
  }
}

/**
 * Jobs are held in memory for as long as the client keeps talking to them. The
 * cap is a leak guard, not a policy: a client that walks away mid-carve should
 * not cost the server anything a later one needs.
 */
const MAX_JOBS = 8
const jobs = new Map<string, Job>()

function remember(job: Job): void {
  jobs.set(job.id, job)
  while (jobs.size > MAX_JOBS) {
    // Oldest finished job first; only evict a running one if they all are.
    const victim =
      [...jobs.values()].find((candidate) => candidate.state !== 'running') ?? [...jobs.values()][0]
    if (!victim) break
    victim.controller.abort()
    jobs.delete(victim.id)
  }
}

let counter = 0

export interface StartOptions {
  sources: Source[]
  intent: string
  format?: FormatId
  params?: Record<string, unknown>
  lang?: string
  windowChars?: number
}

export function start(options: StartOptions): { id: string; settled: Promise<Settled> } {
  counter += 1
  const job = new Job(`carve-${counter}`)
  remember(job)

  const run = carve({
    sources: options.sources,
    intent: options.intent,
    ...(options.format ? { format: options.format } : {}),
    ...(options.params ? { params: options.params } : {}),
    ...(options.lang ? { lang: options.lang } : {}),
    ...(options.windowChars ? { windowChars: options.windowChars } : {}),
    llm: job.model(),
    signal: job.controller.signal,
    onProgress: ({ stage, message }) => job.progress.push(`${stage}: ${message}`),
  })

  run.then(
    (result) => {
      job.state = 'done'
      job.result = result
      job.notify()
    },
    (error: unknown) => {
      job.state = 'failed'
      job.error = error instanceof Error ? error : new Error(String(error))
      job.notify()
    },
  )

  return { id: job.id, settled: job.settle() }
}

export class NoSuchJob extends Error {
  constructor(id: string) {
    super(`No carve called \`${id}\` is open. Start one with ankou_carve_start.`)
  }
}

/**
 * Hand an answer back to a parked run.
 *
 * Validation happens here rather than inside the pipeline so a wrong shape costs
 * the caller a retry and not the whole carve — the same courtesy ankou extends
 * to an API provider that returns something the schema does not accept.
 */
export function answer(id: string, output: unknown): { problems: string[] } | Promise<Settled> {
  const job = jobs.get(id)
  if (!job) throw new NoSuchJob(id)
  const pending = job.pending
  if (!pending) {
    throw new Error(`\`${id}\` is not waiting for anything right now.`)
  }

  if (pending.request.schema) {
    const problems = validate(output, pending.request.schema as never)
    if (problems.length > 0) return { problems }
  }

  job.pending = undefined
  const settled = job.settle()
  pending.resolve(output)
  return settled
}

export function fail(id: string, reason: string): Promise<Settled> {
  const job = jobs.get(id)
  if (!job) throw new NoSuchJob(id)
  const pending = job.pending
  if (!pending) throw new Error(`\`${id}\` is not waiting for anything right now.`)
  job.pending = undefined
  const settled = job.settle()
  pending.reject(new Error(reason))
  return settled
}

export function cancel(id: string): void {
  const job = jobs.get(id)
  if (!job) throw new NoSuchJob(id)
  job.controller.abort()
  job.pending?.reject(new Error('cancelled'))
  job.pending = undefined
  jobs.delete(id)
}

export function pieceOf(id: string): Piece | undefined {
  return jobs.get(id)?.result?.piece
}

export function open(): { id: string; state: string; waiting: boolean }[] {
  return [...jobs.values()].map((job) => ({
    id: job.id,
    state: job.state,
    waiting: Boolean(job.pending),
  }))
}
