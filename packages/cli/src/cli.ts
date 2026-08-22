#!/usr/bin/env node
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, resolve } from 'node:path'
import {
  chew,
  chewPlan,
  type Document,
  FORMAT_IDS,
  isFormatId,
  isRendererId,
  KamuError,
  type Piece,
  type Plan,
  PROVIDERS,
  type ProviderId,
  playTui,
  RENDERERS,
  render,
  type Source,
} from '@shinyaigeek/kamu-core'
import { flagBool, flagList, flagString, parseArgs, parseParams } from './args.js'
import { loadConfig } from './config.js'
import { formatsText, helpText } from './help.js'
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
  return slug || 'kamu'
}

async function main(argv: string[]): Promise<number> {
  const args = parseArgs(argv)
  const quiet = flagBool(args, 'quiet') ?? false
  const ui = createUi(quiet)

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
    process.stdout.write(`${PROVIDERS.join('\n')}\n`)
    return 0
  }
  if (flagBool(args, 'help') || args.positionals.length === 0) {
    process.stdout.write(helpText(ui.colour))
    return args.positionals.length === 0 && !flagBool(args, 'help') ? 1 : 0
  }

  const config = await loadConfig()

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
      'Tell kamu what you want out of this.',
      'e.g. kamu spec.md -i "一字一句頭に入れたい"  — or pass --format to pick a shape directly.',
    )
    return 1
  }
  if (formatFlag && !isFormatId(formatFlag)) {
    ui.error(`Unknown format \`${formatFlag}\`.`, `Known formats: ${FORMAT_IDS.join(', ')}.`)
    return 1
  }

  const rendererFlag = flagBool(args, 'play')
    ? 'tui'
    : (flagString(args, 'render') ?? config.renderer ?? 'html')
  if (!isRendererId(rendererFlag)) {
    ui.error(`Unknown renderer \`${rendererFlag}\`.`, `Known renderers: ${RENDERERS.join(', ')}.`)
    return 1
  }

  const providerFlag = flagString(args, 'provider') ?? config.provider
  if (providerFlag && !(PROVIDERS as string[]).includes(providerFlag)) {
    ui.error(`Unknown provider \`${providerFlag}\`.`, `Known providers: ${PROVIDERS.join(', ')}.`)
    return 1
  }

  const theme = (flagString(args, 'theme') ?? config.theme ?? 'auto') as 'dark' | 'light' | 'auto'
  const windowChars = Number(flagString(args, 'window') ?? config.windowChars ?? 24_000)
  const controller = new AbortController()
  process.once('SIGINT', () => controller.abort())

  // --- chew ----------------------------------------------------------------
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
    },
    onProgress: (event: { message: string }) => spinner.update(event.message),
    signal: controller.signal,
  }

  // `--plan-only` stops after the planner, which is the point of it: composing
  // is where the tokens go, and the reader asked what kamu would make, not for
  // it to be made.
  let result: { plan: Plan; documents: Document[]; piece?: Piece }
  try {
    result = planOnly ? await chewPlan(options) : await chew(options)
  } catch (error) {
    spinner.stop()
    if (controller.signal.aborted) {
      ui.warn('Stopped.')
      return 130
    }
    if (error instanceof KamuError) {
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

  // --- render --------------------------------------------------------------
  const outFlag = flagString(args, 'out')

  if (rendererFlag === 'tui' && !outFlag && process.stdout.isTTY && process.stdin.isTTY) {
    await playTui(piece, { signal: controller.signal })
    return 0
  }

  const output = render(piece, rendererFlag, { theme })

  if (outFlag === '-' || (!outFlag && rendererFlag !== 'html')) {
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
    if (error instanceof KamuError) ui.error(error.message, error.hint)
    else ui.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
