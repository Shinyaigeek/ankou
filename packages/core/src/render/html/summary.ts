import type { SummaryPiece } from '../../types.js'
import { escapeHtml } from '../../util/text.js'
import { type HtmlParts, htmlDocument } from './shell.js'

const STYLES = `
.sm-wrap { max-width: 48rem; margin: 0 auto; padding: 4rem 1.4rem 2rem; }
.sm-wrap h1 { font-size: clamp(1.7rem, 5vw, 2.7rem); margin: 0 0 .3rem; letter-spacing: -.025em; line-height: 1.2; }
.sm-source { color: var(--fg-faint); font-size: .82rem; margin: 0 0 2.4rem; }
.sm-source a { color: inherit; }
.sm-tldr {
  background: var(--accent-soft); border-radius: var(--radius);
  padding: 1.4rem 1.5rem; margin-bottom: 2.6rem;
  font-size: 1.06rem; line-height: 1.65;
}
.sm-tldr h2 {
  font-size: .7rem; letter-spacing: .16em; text-transform: uppercase;
  color: var(--accent); margin: 0 0 .5rem;
}
.sm-wrap section { margin-bottom: 2.6rem; }
.sm-wrap section > h2 {
  font-size: .74rem; letter-spacing: .14em; text-transform: uppercase;
  color: var(--fg-faint); margin: 0 0 1rem; padding-bottom: .5rem;
  border-bottom: 1px solid var(--border);
}
.sm-points { list-style: none; margin: 0; padding: 0; display: grid; gap: 1rem; }
.sm-points li { padding-left: 1.6rem; position: relative; }
.sm-points li::before {
  content: ''; position: absolute; left: 0; top: .62em;
  width: .5rem; height: .5rem; border-radius: 50%; background: var(--accent);
}
.sm-points b { font-weight: 580; }
.sm-points span { display: block; color: var(--fg-muted); font-size: .93rem; margin-top: .2rem; }
.sm-outline details {
  border: 1px solid var(--border); border-radius: 10px; margin-bottom: .6rem;
  background: var(--bg-raised); overflow: hidden;
}
.sm-outline summary { cursor: pointer; padding: .8rem 1rem; font-weight: 560; list-style: none; }
.sm-outline summary::-webkit-details-marker { display: none; }
.sm-outline summary::before { content: '▸ '; color: var(--fg-faint); }
.sm-outline details[open] summary::before { content: '▾ '; }
.sm-outline .body { padding: 0 1rem 1rem 2rem; color: var(--fg-muted); font-size: .95rem; }
.sm-outline .body ul { margin: .6rem 0 0; padding-left: 1.1rem; }
.sm-outline .body li { margin-bottom: .3rem; }
.sm-glossary { display: grid; gap: .8rem; }
.sm-glossary div { display: grid; grid-template-columns: minmax(6rem, 12rem) 1fr; gap: 1rem; font-size: .95rem; }
.sm-glossary dt, .sm-glossary b { font-weight: 600; color: var(--accent); }
.sm-glossary span { color: var(--fg-muted); }
@media (max-width: 34rem) { .sm-glossary div { grid-template-columns: 1fr; gap: .2rem; } }
.sm-open { list-style: none; margin: 0; padding: 0; display: grid; gap: .7rem; }
.sm-open li { color: var(--fg-muted); padding-left: 1.6rem; position: relative; }
.sm-open li::before { content: '?'; position: absolute; left: 0; color: var(--accent); font-weight: 700; }
`

export function renderSummaryHtml(piece: SummaryPiece, theme: 'dark' | 'light' | 'auto'): string {
  const sources = piece.meta.sources
    .map((source) =>
      /^https?:/.test(source.ref)
        ? `<a href="${escapeHtml(source.ref)}">${escapeHtml(source.title)}</a>`
        : escapeHtml(source.title),
    )
    .join(' · ')

  const section = (title: string, inner: string, className = '') =>
    inner ? `<section class="${className}"><h2>${title}</h2>${inner}</section>` : ''

  const parts: HtmlParts = {
    styles: STYLES,
    body: `
<main class="sm-wrap">
  <h1>${escapeHtml(piece.title)}</h1>
  <p class="sm-source">${sources} · ${piece.meta.charCount.toLocaleString('en-US')} characters carved</p>

  ${piece.tldr ? `<div class="sm-tldr"><h2>TL;DR</h2>${escapeHtml(piece.tldr)}</div>` : ''}

  ${section(
    'Key points',
    piece.keyPoints.length
      ? `<ul class="sm-points">${piece.keyPoints
          .map(
            (point) =>
              `<li><b>${escapeHtml(point.text)}</b>${
                point.detail ? `<span>${escapeHtml(point.detail)}</span>` : ''
              }</li>`,
          )
          .join('')}</ul>`
      : '',
  )}

  ${section(
    'Section by section',
    piece.outline.length
      ? piece.outline
          .map(
            (item, index) => `<details${index === 0 ? ' open' : ''}>
      <summary>${escapeHtml(item.title || `Part ${index + 1}`)}</summary>
      <div class="body">${escapeHtml(item.summary)}${
        item.points.length
          ? `<ul>${item.points.map((point) => `<li>${escapeHtml(point)}</li>`).join('')}</ul>`
          : ''
      }</div>
    </details>`,
          )
          .join('')
      : '',
    'sm-outline',
  )}

  ${section(
    'Glossary',
    piece.glossary.length
      ? `<div class="sm-glossary">${piece.glossary
          .map(
            (entry) =>
              `<div><b>${escapeHtml(entry.term)}</b><span>${escapeHtml(entry.definition)}</span></div>`,
          )
          .join('')}</div>`
      : '',
  )}

  ${section(
    'Left open',
    piece.openQuestions.length
      ? `<ul class="sm-open">${piece.openQuestions
          .map((question) => `<li>${escapeHtml(question)}</li>`)
          .join('')}</ul>`
      : '',
  )}
</main>
`,
  }
  return htmlDocument(
    { title: piece.title, lang: piece.lang, subtitle: piece.meta.sources[0]?.title, theme },
    parts,
  )
}
