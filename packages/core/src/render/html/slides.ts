import type { Slide, SlidesPiece } from '../../types.js'
import { escapeHtml } from '../../util/text.js'
import { type HtmlParts, htmlDocument } from './shell.js'

const STYLES = `
body { height: 100dvh; overflow: hidden; }
.sl-deck { height: 100dvh; display: flex; flex-direction: column; }
.sl-viewport { flex: 1; position: relative; min-height: 0; }
.sl-slide {
  position: absolute; inset: 0; display: none;
  flex-direction: column; justify-content: center;
  padding: clamp(1.5rem, 6vmin, 5rem) clamp(1.5rem, 9vmin, 8rem);
  gap: 1.4rem; overflow-y: auto;
}
.sl-slide.on { display: flex; animation: slFade .28s ease both; }
@keyframes slFade { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: none; } }
.sl-kicker { font-size: .74rem; letter-spacing: .16em; text-transform: uppercase; color: var(--fg-faint); }
.sl-slide h2 {
  margin: 0; font-size: clamp(1.6rem, 5.2vmin, 3.4rem); line-height: 1.22;
  font-weight: 650; letter-spacing: -.02em; max-width: 24ch;
}
.sl-slide ul { margin: 0; padding: 0; list-style: none; display: grid; gap: .7rem; max-width: 62ch; }
.sl-slide li {
  font-size: clamp(.95rem, 2.3vmin, 1.3rem); color: var(--fg-muted);
  padding-left: 1.4rem; position: relative; line-height: 1.55;
}
.sl-slide li::before {
  content: ''; position: absolute; left: 0; top: .62em;
  width: .5rem; height: .5rem; border-radius: 2px; background: var(--accent); opacity: .8;
}
.sl-visual { margin-top: .4rem; max-width: 70ch; }
.sl-quote {
  border-left: 3px solid var(--accent); padding: .3rem 0 .3rem 1.2rem;
  font-family: var(--font-serif); font-size: clamp(1.05rem, 2.8vmin, 1.7rem); line-height: 1.5;
}
.sl-quote cite { display: block; margin-top: .6rem; font-size: .8em; font-style: normal; color: var(--fg-faint); }
.sl-stat { display: flex; align-items: baseline; gap: 1rem; flex-wrap: wrap; }
.sl-stat b { font-size: clamp(2.4rem, 9vmin, 5rem); color: var(--accent); line-height: 1; letter-spacing: -.03em; }
.sl-stat span { color: var(--fg-muted); font-size: 1.05rem; }
.sl-notes {
  border-top: 1px solid var(--border); background: var(--bg-sunken);
  padding: .9rem clamp(1.5rem, 9vmin, 8rem); font-size: .86rem; color: var(--fg-muted);
  max-height: 26vh; overflow-y: auto; display: none;
}
.sl-notes.on { display: block; }
.sl-bar {
  display: flex; align-items: center; gap: 1rem; flex-wrap: wrap;
  padding: .55rem clamp(1rem, 4vmin, 2rem); border-top: 1px solid var(--border);
  font-size: .76rem; color: var(--fg-faint);
}
.sl-bar kbd {
  font-family: var(--font-mono); font-size: .9em; border: 1px solid var(--border);
  border-bottom-width: 2px; border-radius: 5px; padding: 0 .35em; color: var(--fg-muted);
}
.sl-bar .count { margin-left: auto; padding-right: 5rem; font-family: var(--font-mono); font-variant-numeric: tabular-nums; }
.sl-dots { position: fixed; left: 0; right: 0; bottom: 0; height: 3px; background: var(--bg-sunken); }
.sl-dots i { display: block; height: 100%; background: var(--accent); transition: width .2s ease; }
@media print {
  body, .sl-deck, .sl-viewport { height: auto; overflow: visible; }
  .sl-slide { position: static; display: flex !important; break-after: page; min-height: 90vh; animation: none; }
  .sl-notes { display: block; max-height: none; }
  .sl-bar, .sl-dots { display: none; }
}
`

const SCRIPT = `
(function () {
  var slides = Array.prototype.slice.call(document.querySelectorAll('.sl-slide'));
  var notes = document.querySelector('.sl-notes');
  var count = document.querySelector('.sl-bar .count');
  var progress = document.querySelector('.sl-dots i');
  var at = 0;

  function show(index) {
    at = Math.max(0, Math.min(slides.length - 1, index));
    slides.forEach(function (slide, i) { slide.className = 'sl-slide' + (i === at ? ' on' : ''); });
    notes.textContent = slides[at].getAttribute('data-notes') || '';
    count.textContent = (at + 1) + ' / ' + slides.length;
    progress.style.width = ((at + 1) / slides.length * 100) + '%';
    if (location.hash !== '#' + (at + 1)) history.replaceState(null, '', '#' + (at + 1));
  }

  document.addEventListener('keydown', function (event) {
    switch (event.key) {
      case 'ArrowRight': case ' ': case 'PageDown': event.preventDefault(); show(at + 1); break;
      case 'ArrowLeft': case 'PageUp': event.preventDefault(); show(at - 1); break;
      case 'Home': show(0); break;
      case 'End': show(slides.length - 1); break;
      case 'n': notes.classList.toggle('on'); break;
      case 'f':
        if (document.fullscreenElement) document.exitFullscreen();
        else document.documentElement.requestFullscreen();
        break;
    }
  });
  document.querySelector('.sl-viewport').addEventListener('click', function (event) {
    show(event.clientX < window.innerWidth / 3 ? at - 1 : at + 1);
  });

  var fromHash = function () { return Math.max(0, (parseInt(location.hash.slice(1), 10) || 1) - 1); };
  // The hash is a real address for a slide, so it has to work when it arrives
  // late: a link pasted into an open deck, or the back button after a jump.
  // show() writes the same hash back, and an unchanged hash fires nothing.
  window.addEventListener('hashchange', function () { show(fromHash()); });
  show(fromHash());
})();
`

function visualHtml(slide: Slide): string {
  const visual = slide.visual
  if (!visual) return ''
  switch (visual.type) {
    case 'quote':
      return `<div class="sl-visual"><blockquote class="sl-quote">${escapeHtml(visual.text)}${
        visual.attribution ? `<cite>${escapeHtml(visual.attribution)}</cite>` : ''
      }</blockquote></div>`
    case 'stat':
      return `<div class="sl-visual sl-stat"><b>${escapeHtml(visual.value)}</b><span>${escapeHtml(
        visual.caption,
      )}</span></div>`
    case 'mermaid':
      return `<div class="sl-visual kamu-scroll"><pre class="mermaid">${escapeHtml(visual.code)}</pre></div>`
    case 'code':
      return `<div class="sl-visual kamu-scroll"><pre><code class="language-${escapeHtml(
        visual.language,
      )}">${escapeHtml(visual.code)}</code></pre></div>`
    default:
      return ''
  }
}

export function renderSlidesHtml(piece: SlidesPiece, theme: 'dark' | 'light' | 'auto'): string {
  const slides = piece.slides
    .map(
      (slide, index) => `
  <section class="sl-slide" data-notes="${escapeHtml(slide.notes ?? '')}">
    <span class="sl-kicker">${escapeHtml(piece.title)} · ${index + 1}</span>
    <h2>${escapeHtml(slide.title)}</h2>
    ${
      slide.bullets.length
        ? `<ul>${slide.bullets.map((bullet) => `<li>${escapeHtml(bullet)}</li>`).join('')}</ul>`
        : ''
    }
    ${visualHtml(slide)}
  </section>`,
    )
    .join('\n')

  const parts: HtmlParts = {
    styles: STYLES,
    script: SCRIPT,
    body: `
<div class="sl-deck">
  <div class="sl-viewport">${slides}</div>
  <div class="sl-notes"></div>
  <div class="sl-bar">
    <span><kbd>←</kbd><kbd>→</kbd> move</span>
    <span><kbd>n</kbd> notes</span>
    <span><kbd>f</kbd> fullscreen</span>
    <span class="count"></span>
  </div>
</div>
<div class="sl-dots"><i></i></div>
`,
  }
  return htmlDocument(
    {
      title: piece.title,
      lang: piece.lang,
      subtitle: piece.meta.sources[0]?.title,
      theme,
      fullBleed: true,
    },
    parts,
  )
}
