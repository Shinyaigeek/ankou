#!/usr/bin/env node
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, resolve } from 'node:path'
import {
  AnkouError,
  carve,
  carvePlan,
  type Document,
  FORMAT_IDS,
  isFormatId,
  isPiece,
  isRendererId,
  type Piece,
  type Plan,
  PROVIDERS,
  type ProviderId,
  pieceProblems,
  playTui,
  providerStatus,
  RENDERERS,
  type RendererId,
  render,
  type Source,
} from 'ankou-core'
import { flagBool, flagList, flagString, nearestFlag, parseArgs, parseParams } from './args.js'
import { type AnkouConfig, loadConfig } from './config.js'
import { formatsText, helpText, providersText } from './help.js'
import { openInBrowser } from './open.js'
import { createUi } from './ui.js'

const VERSION = '0.1.0'

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk))
  return Buffer.concat(chunks).toString('utf8')
}

function slugify(input: string): string {
  const slug = input
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
  return slug || 'ankou'
}

async function main(argv: string[]): Promise<number> {
  const args = parseArgs(argv)
  const quiet = flagBool(args, 'quiet') ?? false
  const ui = createUi(quiet)

  // Before anything else: a flag nobody defined is a typo, and obeying the rest
  // of the line anyway is how `--plan-onlyy` bills you for the run you were
  // trying not to make.
  if (args.unknown.length > 0) {
    const [first] = args.unknown
    const guess = nearestFlag(first!.replace(/^-+/, ''))
    ui.error(
      `Unknown ${args.unknown.length === 1 ? 'option' : 'options'}: ${args.unknown.join(', ')}.`,
      guess
        ? `Did you mean \`--${guess}\`? Run \`ankou --help\` for the full list.`
        : 'Run `ankou --help` for the full list.',
    )
    return 1
  }

  if (flagBool(args, 'version')) {
    process.stdout.write(`${VERSION}\n`)
    return 0
  }

  const command = args.positionals[0]
  if (command === 'formats') {
    process.stdout.write(formatsText(ui.colour))
    return 0
  }
  if (command === 'providers') {
    process.stdout.write(providersText(await providerStatus(), ui.colour))
    return 0
  }
  if (flagBool(args, 'help') || args.positionals.length === 0) {
    process.stdout.write(helpText(ui.colour))
    return args.positionals.length === 0 && !flagBool(args, 'help') ? 1 : 0
  }

  const { config, problems } = await loadConfig()
  // A config file is a convenience, so a broken one warns rather than stops —
  // but it does not sit there being silently ignored.
  for (const problem of problems) ui.warn(problem)

  const rendererFlag = flagBool(args, 'play')
    ? 'tui'
    : (flagString(args, 'render') ?? config.renderer ?? 'html')
  if (!isRendererId(rendererFlag)) {
    ui.error(`Unknown renderer \`${rendererFlag}\`.`, `Known renderers: ${RENDERERS.join(', ')}.`)
    return 1
  }
  const theme = (flagString(args, 'theme') ?? config.theme ?? 'auto') as 'dark' | 'light' | 'auto'

  // `ankou render <piece.json>` — a piece outlives the run that made it, so
  // changing the surface it is read on should not mean paying the model again.
  if (command === 'render') {
    const source = args.positionals[1]
    if (!source) {
      ui.error(
        'ankou render needs a piece to render.',
        'e.g. ankou render deck.json --render html — or "-" to read stdin.',
      )
      return 1
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(source === '-' ? await readStdin() : await readFile(source, 'utf8'))
    } catch (error) {
      ui.error(
        `Could not read a piece from \`${source}\`.`,
        error instanceof Error ? error.message : undefined,
      )
      return 1
    }
    const problems = pieceProblems(parsed)
    if (problems.length > 0 || !isPiece(parsed)) {
      ui.error(
        `\`${source}\` is not a ankou piece ankou can render.`,
        `Missing or wrong: ${problems.join(', ')}. A piece is what \`--render json\` writes.`,
      )
      return 1
    }
    return deliver(parsed, {
      args,
      config,
      ui,
      renderer: rendererFlag,
      theme,
      signal: new AbortController().signal,
    })
  }

  // --- resolve the sources -------------------------------------------------
  const sources: Source[] = []
  for (const positional of args.positionals) {
    if (positional === '-') {
      const content = await readStdin()
      if (!content.trim()) {
        ui.error('Nothing arrived on stdin.')
        return 1
      }
      sources.push({ content, name: 'stdin' })
    } else {
      sources.push(positional)
    }
  }

  const intent = flagString(args, 'intent')
  const formatFlag = flagString(args, 'format')
  if (!intent && !formatFlag) {
    ui.error(
      'Tell ankou what you want out of this.',
      'e.g. ankou spec.md -i "一字一句頭に入れたい"  — or pass --format to pick a shape directly.',
    )
    return 1
  }
  if (formatFlag && !isFormatId(formatFlag)) {
    ui.error(`Unknown format \`${formatFlag}\`.`, `Known formats: ${FORMAT_IDS.join(', ')}.`)
    return 1
  }

  const providerFlag = flagString(args, 'provider') ?? config.provider
  if (providerFlag && !(PROVIDERS as string[]).includes(providerFlag)) {
    ui.error(`Unknown provider \`${providerFlag}\`.`, `Known providers: ${PROVIDERS.join(', ')}.`)
    return 1
  }

  const windowChars = Number(flagString(args, 'window') ?? config.windowChars ?? 24_000)
  const controller = new AbortController()
  process.once('SIGINT', () => controller.abort())

  // --- carve ----------------------------------------------------------------
  const planOnly = flagBool(args, 'plan-only') ?? false
  const spinner = ui.spinner('Reading the sources')
  const options = {
    sources,
    intent: intent ?? `Deliver this as ${formatFlag}.`,
    ...(formatFlag && isFormatId(formatFlag) ? { format: formatFlag } : {}),
    params: parseParams(flagList(args, 'param')),
    ...(providerFlag ? { provider: providerFlag as ProviderId } : {}),
    providerOptions: {
      ...((flagString(args, 'model') ?? config.model)
        ? { model: flagString(args, 'model') ?? config.model }
        : {}),
      ...((flagString(args, 'base-url') ?? config.baseUrl)
        ? { baseUrl: flagString(args, 'base-url') ?? config.baseUrl }
        : {}),
    },
    ...(flagString(args, 'lang') ? { lang: flagString(args, 'lang') } : {}),
    windowChars: Number.isFinite(windowChars) ? windowChars : 24_000,
    ingest: {
      full: flagBool(args, 'full') ?? false,
      timeoutMs: Number(flagString(args, 'timeout') ?? 30_000),
      ...(flagString(args, 'encoding') ? { encoding: flagString(args, 'encoding') } : {}),
    },
    onProgress: (event: { message: string }) => spinner.update(event.message),
    signal: controller.signal,
  }

  // `--plan-only` stops after the planner, which is the point of it: composing
  // is where the tokens go, and the reader asked what ankou would make, not for
  // it to be made.
  let result: { plan: Plan; documents: Document[]; piece?: Piece }
  try {
    result = planOnly ? await carvePlan(options) : await carve(options)
  } catch (error) {
    spinner.stop()
    if (controller.signal.aborted) {
      ui.warn('Stopped.')
      return 130
    }
    if (error instanceof AnkouError) {
      ui.error(error.message, error.hint)
      return 1
    }
    throw error
  }
  spinner.stop()

  const { plan, documents } = result
  ui.done(
    `${plan.format} · ${documents.length} source${documents.length === 1 ? '' : 's'} · ${documents
      .reduce((sum, document) => sum + document.charCount, 0)
      .toLocaleString('en-US')} characters`,
  )
  if (plan.rationale) ui.info(`  ${plan.rationale}`)

  const piece = result.piece
  if (!piece) {
    process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`)
    return 0
  }

  return deliver(piece, {
    args,
    config,
    ui,
    renderer: rendererFlag,
    theme,
    signal: controller.signal,
  })
}

interface DeliverContext {
  args: ReturnType<typeof parseArgs>
  config: AnkouConfig
  ui: ReturnType<typeof createUi>
  renderer: RendererId
  theme: 'dark' | 'light' | 'auto'
  signal: AbortSignal
}

/**
 * Put a finished piece somewhere: a live terminal session, stdout, or a file.
 *
 * Shared by carving and by `ankou render`, because where the piece came from —
 * a model just now, or a JSON file from last week — makes no difference to
 * where it should go.
 */
async function deliver(piece: Piece, context: DeliverContext): Promise<number> {
  const { args, config, ui, renderer, theme } = context
  const outFlag = flagString(args, 'out')

  if (renderer === 'tui' && !outFlag && process.stdout.isTTY && process.stdin.isTTY) {
    await playTui(piece, { signal: context.signal })
    return 0
  }

  const output = render(piece, renderer, { theme })

  if (outFlag === '-' || (!outFlag && renderer !== 'html')) {
    process.stdout.write(output.content)
    return 0
  }

  const target = outFlag
    ? isAbsolute(outFlag)
      ? outFlag
      : resolve(process.cwd(), outFlag)
    : resolve(config.outDir ?? process.cwd(), `${slugify(piece.title)}.${output.ext}`)

  await mkdir(dirname(target), { recursive: true })
  await writeFile(target, output.content, 'utf8')
  ui.done(target)

  if (flagBool(args, 'open') ?? config.open) openInBrowser(target)
  return 0
}

main(process.argv.slice(2))
  .then((code) => {
    process.exitCode = code
  })
  .catch((error: unknown) => {
    const ui = createUi(false)
    if (error instanceof AnkouError) ui.error(error.message, error.hint)
    else ui.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
