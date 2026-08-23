// The smallest real usage: one source, one intent, one file out.
// Needs ANTHROPIC_API_KEY (or pass `provider: 'claude-code'` / 'ollama').
import { writeFile } from 'node:fs/promises'
import { carveAndRender } from 'ankou-core'

const { piece, plan, output } = await carveAndRender({
  sources: [process.argv[2] ?? 'README.md'],
  intent: process.argv[3] ?? 'I want to take this in properly, without skimming',
  renderer: 'html',
  onProgress: (event) => console.error(`${event.stage}: ${event.message}`),
})

console.error(`${plan.format}: ${plan.rationale}`)
await writeFile(`${piece.format}.html`, output.content, 'utf8')
console.log(`${piece.format}.html`)
