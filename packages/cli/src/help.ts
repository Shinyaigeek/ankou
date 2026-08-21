import { FORMAT_IDS, FORMATS, PROVIDERS, RENDERERS } from '@shinyaigeek/kamu-core'
import { style } from './ui.js'

const { ansi, palette } = style

export function helpText(colour: boolean): string {
  const c = (text: string, ...codes: string[]) =>
    colour ? `${codes.join('')}${text}${ansi.reset}` : text

  return `${c('kamu', ansi.bold)} — chew documents into the shape you actually want to read them in

${c('USAGE', ansi.bold)}
  kamu <source...> --intent "<what you want out of it>" [options]
  kamu formats
  kamu providers

  Sources are file paths, URLs, or "-" for stdin. Markdown, plain text, HTML and
  PDF are understood; a URL is fetched and stripped down to the readable part.

${c('EXAMPLES', ansi.bold)}
  kamu spec.md -i "一字一句漏らさず頭に入れたい"
  kamu https://example.com/post -i "覚えたい" --render tui
  kamu paper.pdf notes.md -i "explain it to me like I have never seen it"
  cat draft.txt | kamu - -i "make it land" --format animation --open

${c('OPTIONS', ansi.bold)}
  -i, --intent <text>     What you want out of the source. This is the brief.
  -f, --format <id>       Skip the planner and use this format.
  -r, --render <id>       ${RENDERERS.join(' | ')}  (default: html)
  -o, --out <file>        Where to write. Default: a file next to your cwd.
      --open              Open the result when it is written.
      --play              Shorthand for --render tui.
  -p, --provider <id>     ${PROVIDERS.join(' | ')}
  -m, --model <id>        Model name for the provider.
      --base-url <url>    Override the provider endpoint.
      --theme <mode>      dark | light | auto  (default: auto)
      --lang <tag>        Force the output language, e.g. ja, en.
      --param k=v         Format knob; repeatable. See \`kamu formats\`.
      --window <chars>    Source characters per model call (default: 24000).
      --timeout <ms>      URL fetch timeout (default: 30000).
      --full              Keep the whole HTML page instead of extracting.
      --plan-only         Print the plan and stop, without generating.
  -q, --quiet             No progress output.
  -h, --help              This text.
  -v, --version           Print the version.

${c('FORMATS', ansi.bold)}
${FORMAT_IDS.map((id) => `  ${c(id.padEnd(10), palette.accent)}${FORMATS[id].description}`).join('\n')}

${c('CREDENTIALS', ansi.bold)}
  ANTHROPIC_API_KEY   for --provider anthropic (the default)
  OPENAI_API_KEY      for --provider openai (also OpenRouter, LM Studio, vLLM)
  --provider claude-code uses a Claude Code subscription, no key needed
  --provider ollama runs locally against OLLAMA_HOST

  Config file: ~/.config/kamu/config.json — { "provider": "...", "model": "..." }
`
}

export function formatsText(colour: boolean): string {
  const c = (text: string, ...codes: string[]) =>
    colour ? `${codes.join('')}${text}${ansi.reset}` : text

  return FORMAT_IDS.map((id) => {
    const format = FORMATS[id]
    const params = Object.entries(format.params)
    return `${c(format.label, ansi.bold, palette.accent)}  ${c(`(--format ${id})`, palette.faint)}
  ${format.description}

  ${c('Reach for it when:', palette.muted)}
${format.bestFor.map((use) => `    - ${use}`).join('\n')}
${
  params.length
    ? `\n  ${c('Params:', palette.muted)}\n${params
        .map(([key, description]) => `    --param ${key}=…  ${description}`)
        .join('\n')}`
    : ''
}
`
  }).join('\n')
}
