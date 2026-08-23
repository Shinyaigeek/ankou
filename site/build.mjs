// Build the ankou site: a handful of HTML fragments wrapped in one layout, plus
// the gallery's rendered pages copied in as live demos.
//
// No framework, for the same reason ankou-core has no runtime dependencies: the
// output is static HTML, and a build step nobody can read is a build step
// nobody maintains.
import { copyFile, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const outDir = join(root, '_site')
const galleryDir = join(root, 'examples', 'out')

const NAV = [
  { href: './formats.html', label: 'Formats' },
  { href: './providers.html', label: 'Providers' },
  { href: './agents.html', label: 'Agents' },
  { href: 'https://github.com/Shinyaigeek/ankou', label: 'GitHub', external: true },
]

const PAGES = [
  {
    slug: 'index',
    title: 'ankou — carve a document into the shape you want to read it in',
    description:
      'ankou takes documents and what you want out of them, picks the shape — flipbook, slides, quiz, animation, summary, dialogue — and renders it as a page you can actually read.',
  },
  {
    slug: 'formats',
    title: 'Formats — ankou',
    description:
      'The six shapes ankou can carve a document into, what each one is for, and a live rendered example of every single one.',
  },
  {
    slug: 'providers',
    title: 'LLM providers — ankou',
    description:
      'Anthropic, OpenAI-compatible endpoints, Ollama, a Claude Code subscription, or any model you bring yourself.',
  },
  {
    slug: 'agents',
    title: 'Using ankou from an agent — ankou',
    description:
      'ankou as a tool call: one typed Piece, many surfaces, your host model, cancellation and progress included.',
  },
]

const layout = await readFile(join(here, 'layout.html'), 'utf8')

const nav = (slug) =>
  NAV.map(({ href, label, external }) => {
    const current = href === `./${slug}.html`
    return `<a href="${href}"${current ? ' aria-current="page"' : ''}${
      external ? ' rel="noreferrer"' : ''
    }>${label}</a>`
  }).join('\n        ')

await rm(outDir, { recursive: true, force: true })
await mkdir(join(outDir, 'demo'), { recursive: true })

for (const page of PAGES) {
  const content = await readFile(join(here, 'pages', `${page.slug}.html`), 'utf8')
  const html = layout
    .replaceAll('{{title}}', page.title)
    .replaceAll('{{description}}', page.description)
    .replaceAll('{{nav}}', nav(page.slug))
    .replaceAll('{{home}}', page.slug === 'index' ? 'aria-current="page"' : '')
    .replaceAll('{{content}}', content)
  await writeFile(join(outDir, `${page.slug}.html`), html)
}

await copyFile(join(here, 'styles.css'), join(outDir, 'styles.css'))
await copyFile(join(here, 'site.js'), join(outDir, 'site.js'))

// The demos are the gallery's own output, unedited. If they are missing the
// site would still build and quietly serve six dead iframes, so it stops here
// instead — `node examples/gallery.mjs` is one command away.
const demos = (await readdir(galleryDir).catch(() => [])).filter((name) => name.endsWith('.html'))
if (demos.length === 0) {
  throw new Error(
    'No rendered demos in examples/out. Run `pnpm build && node examples/gallery.mjs` first.',
  )
}
for (const name of demos) {
  await copyFile(join(galleryDir, name), join(outDir, 'demo', name))
}

console.log(`site → _site (${PAGES.length} pages, ${demos.length} demos)`)
