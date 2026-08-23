import type { DialoguePiece } from '../../types.js'
import { escapeHtml } from '../../util/text.js'
import { type HtmlParts, htmlDocument } from './shell.js'

const STYLES = `
.dg-wrap { max-width: 44rem; margin: 0 auto; padding: 4rem 1.4rem 2rem; }
.dg-wrap h1 { font-size: clamp(1.5rem, 4.4vw, 2.3rem); margin: 0 0 .3rem; letter-spacing: -.02em; }
.dg-cast { display: flex; gap: 1.4rem; flex-wrap: wrap; color: var(--fg-faint); font-size: .82rem; margin: 0 0 2.4rem; }
.dg-cast b { color: var(--fg-muted); }
.dg-turn { display: flex; gap: .9rem; margin-bottom: 1.5rem; align-items: flex-start; }
/* Hidden turns must not hold layout space, or the page opens with a gap. */
.dg-turn.reveal { display: none; }
.dg-turn.shown { animation: dgIn .35s ease both; }
@keyframes dgIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
.dg-avatar {
  flex: none; width: 2.2rem; height: 2.2rem; border-radius: 50%;
  display: grid; place-items: center; font-size: .82rem; font-weight: 700;
  background: var(--bg-sunken); color: var(--fg-muted); border: 1px solid var(--border);
}
.dg-turn.s1 .dg-avatar { background: var(--accent-soft); color: var(--accent); border-color: transparent; }
.dg-body { min-width: 0; }
.dg-name { font-size: .76rem; color: var(--fg-faint); letter-spacing: .05em; margin-bottom: .2rem; }
.dg-text {
  background: var(--bg-raised); border: 1px solid var(--border); border-radius: 4px 14px 14px 14px;
  padding: .75rem 1rem; line-height: 1.7; margin: 0;
}
.dg-turn.s1 .dg-text { background: var(--accent-soft); border-color: transparent; }
.dg-more {
  position: sticky; bottom: 1rem; display: flex; justify-content: center; padding-top: 1rem;
}
.dg-more button { background: var(--accent); border-color: var(--accent); color: #fff; font-weight: 600; box-shadow: var(--shadow); }
`

const SCRIPT = `
(function () {
  var turns = Array.prototype.slice.call(document.querySelectorAll('.dg-turn'));
  var more = document.querySelector('.dg-more');
  var button = more.querySelector('button');
  var at = 0;

  // Revealing one turn at a time keeps the reader in the conversation instead
  // of scanning ahead to the end of the transcript.
  turns.forEach(function (turn, index) {
    if (index > 0) turn.classList.add('reveal');
    else turn.classList.add('shown');
  });

  function reveal() {
    at++;
    if (at >= turns.length) { more.hidden = true; return; }
    turns[at].classList.remove('reveal');
    turns[at].classList.add('shown');
    turns[at].scrollIntoView({ behavior: 'smooth', block: 'center' });
    if (at >= turns.length - 1) more.hidden = true;
  }

  function revealAll() {
    turns.forEach(function (turn) { turn.classList.remove('reveal'); turn.classList.add('shown'); });
    at = turns.length;
    more.hidden = true;
  }

  if (turns.length <= 1) more.hidden = true;
  button.addEventListener('click', reveal);
  document.addEventListener('keydown', function (event) {
    if (event.key === ' ' || event.key === 'ArrowDown') { event.preventDefault(); reveal(); }
    if (event.key === 'a') revealAll();
  });
})();
`

export function renderDialogueHtml(piece: DialoguePiece, theme: 'dark' | 'light' | 'auto'): string {
  const first = piece.speakers[0]?.id
  const initial = (name: string) => [...name.trim()][0] ?? '?'
  const byId = new Map(piece.speakers.map((speaker) => [speaker.id, speaker]))

  const parts: HtmlParts = {
    styles: STYLES,
    script: SCRIPT,
    body: `
<main class="dg-wrap">
  <h1>${escapeHtml(piece.title)}</h1>
  <p class="dg-cast">${piece.speakers
    .map(
      (speaker) => `<span><b>${escapeHtml(speaker.name)}</b> — ${escapeHtml(speaker.role)}</span>`,
    )
    .join('')}</p>
  ${piece.turns
    .map((turn) => {
      const speaker = byId.get(turn.speaker) ?? { name: turn.speaker, id: turn.speaker, role: '' }
      return `<div class="dg-turn ${turn.speaker === first ? 's1' : 's2'}">
    <div class="dg-avatar" aria-hidden="true">${escapeHtml(initial(speaker.name))}</div>
    <div class="dg-body">
      <div class="dg-name">${escapeHtml(speaker.name)}</div>
      <p class="dg-text">${escapeHtml(turn.text)}</p>
    </div>
  </div>`
    })
    .join('\n  ')}
  <div class="dg-more ankou-no-print"><button type="button">Continue — <kbd>space</kbd></button></div>
</main>
`,
  }
  return htmlDocument(
    { title: piece.title, lang: piece.lang, subtitle: piece.meta.sources[0]?.title, theme },
    parts,
  )
}
