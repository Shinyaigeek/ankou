import type { FlipbookPiece } from '../../types.js'
import { escapeHtml } from '../../util/text.js'
import { type HtmlParts, htmlDocument, READ_DATA } from './shell.js'

const STYLES = `
body { height: 100dvh; overflow: hidden; display: flex; flex-direction: column; }
.fb-head {
  display: flex; align-items: baseline; gap: .8rem;
  padding: 1rem 1.4rem .4rem; font-size: .82rem; color: var(--fg-muted);
}
.fb-head .title { font-weight: 600; color: var(--fg); }
.fb-head .chapter { color: var(--fg-muted); }
.fb-head .counter { margin-left: auto; padding-right: 5rem; font-variant-numeric: tabular-nums; font-family: var(--font-mono); }
.fb-progress { height: 3px; background: var(--bg-sunken); margin: 0 1.4rem; border-radius: 2px; overflow: hidden; }
.fb-progress i { display: block; height: 100%; width: 0; background: var(--accent); transition: width .12s linear; }
.fb-stage {
  flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 1.2rem; padding: 1rem; cursor: pointer; user-select: none; min-height: 0;
}
.fb-char {
  font-family: var(--font-serif);
  font-size: clamp(5rem, 26vmin, 16rem);
  line-height: 1; font-weight: 500;
  transition: color .12s ease;
  display: flex; flex-direction: column; align-items: center;
}
.fb-char.w2 { color: var(--accent); }
.fb-char.w3 { color: var(--accent); text-shadow: 0 0 40px var(--accent-soft); }
.fb-char .ruby { font-size: .18em; color: var(--fg-muted); letter-spacing: .1em; height: 1.2em; }
.fb-char .glyph { min-height: 1em; min-width: .3em; }
.fb-gloss {
  min-height: 1.6rem; font-size: .85rem; color: var(--accent);
  background: var(--accent-soft); padding: .1rem .8rem; border-radius: 999px;
  opacity: 0; transition: opacity .2s ease;
}
.fb-gloss.on { opacity: 1; }
.fb-context {
  font-family: var(--font-serif);
  font-size: clamp(.8rem, 2.2vmin, 1.05rem);
  color: var(--fg-faint); text-align: center; max-width: min(70ch, 92vw);
  height: 3.4em; overflow: hidden; line-height: 1.7;
}
.fb-context b { color: var(--fg); font-weight: 500; }
.fb-context .past { color: var(--fg-muted); }
.fb-foot {
  display: flex; align-items: center; gap: 1rem; flex-wrap: wrap;
  padding: .6rem 1.4rem 1.1rem; font-size: .76rem; color: var(--fg-faint);
}
.fb-foot kbd {
  font-family: var(--font-mono); font-size: .9em; border: 1px solid var(--border);
  border-bottom-width: 2px; border-radius: 5px; padding: 0 .35em; color: var(--fg-muted);
}
.fb-foot .speed { margin-left: auto; font-family: var(--font-mono); }
.fb-chapters {
  position: fixed; inset: 0 auto 0 0; width: min(320px, 84vw); z-index: 40;
  background: var(--bg-raised); border-right: 1px solid var(--border);
  transform: translateX(-101%); transition: transform .2s ease;
  overflow-y: auto; padding: 1.2rem 0; box-shadow: var(--shadow);
}
.fb-chapters.on { transform: none; }
.fb-chapters h2 { font-size: .74rem; text-transform: uppercase; letter-spacing: .1em; color: var(--fg-faint); padding: 0 1.2rem; margin: 0 0 .6rem; }
.fb-chapters button {
  display: block; width: 100%; text-align: left; border: 0; border-radius: 0;
  background: none; padding: .55rem 1.2rem; font-size: .88rem; color: var(--fg-muted);
}
.fb-chapters button:hover { background: var(--bg-sunken); }
.fb-chapters button.on { color: var(--accent); background: var(--accent-soft); }
.fb-done { font-size: 1.1rem; color: var(--fg-muted); text-align: center; }
`

const SCRIPT = `
${READ_DATA}
(function () {
  var seg = null;
  try { seg = new Intl.Segmenter(KAMU.lang || undefined, { granularity: 'grapheme' }); } catch (e) {}
  function split(text) {
    if (!seg) return Array.from(text);
    var out = [];
    var it = seg.segment(text)[Symbol.iterator]();
    for (var s = it.next(); !s.done; s = it.next()) out.push(s.value.segment);
    return out;
  }

  var PAUSE_HEAVY = /[。．\\.!！?？\\n]/;
  var PAUSE_LIGHT = /[、,，;；:：)）」』]/;

  // Flatten every chapter into a single tape of annotated graphemes. The text
  // is the source text, untouched: only the annotations come from the model.
  var tape = [];
  var chapterStarts = [];
  KAMU.chapters.forEach(function (chapter, ci) {
    chapterStarts.push(tape.length);
    var chars = split(chapter.text);
    var weights = new Array(chars.length).fill(0);
    var rubies = new Array(chars.length).fill(null);

    function mark(term, apply) {
      if (!term) return;
      var from = 0;
      for (;;) {
        var at = chapter.text.indexOf(term, from);
        if (at < 0) break;
        // Map string offsets onto grapheme indices.
        var offset = 0, start = -1, end = -1;
        for (var i = 0; i < chars.length; i++) {
          if (offset === at) start = i;
          offset += chars[i].length;
          if (offset === at + term.length) { end = i; break; }
        }
        if (start >= 0 && end >= start) apply(start, end);
        from = at + term.length;
      }
    }

    (KAMU.emphasis || []).forEach(function (item) {
      mark(item.term, function (start, end) {
        for (var i = start; i <= end; i++) weights[i] = Math.max(weights[i], item.weight || 1);
        if (item.gloss) rubies[start] = rubies[start] || { gloss: item.gloss };
      });
    });
    (KAMU.ruby || []).forEach(function (item) {
      mark(item.term, function (start) {
        rubies[start] = Object.assign(rubies[start] || {}, { reading: item.reading });
      });
    });

    chars.forEach(function (ch, i) {
      tape.push({ c: ch, w: weights[i], r: rubies[i], ci: ci, i: i });
    });
  });

  var pacing = KAMU.pacing || { baseMs: 55, punctuationMs: 330, paragraphMs: 660 };
  var state = { at: 0, playing: false, rate: 1, timer: null };

  var el = {
    title: document.querySelector('.fb-head .chapter'),
    counter: document.querySelector('.fb-head .counter'),
    bar: document.querySelector('.fb-progress i'),
    glyph: document.querySelector('.fb-char .glyph'),
    ruby: document.querySelector('.fb-char .ruby'),
    charBox: document.querySelector('.fb-char'),
    gloss: document.querySelector('.fb-gloss'),
    context: document.querySelector('.fb-context'),
    speed: document.querySelector('.fb-foot .speed'),
    chapters: document.querySelector('.fb-chapters'),
    playHint: document.querySelector('[data-hint]')
  };

  function delayFor(unit) {
    var base = pacing.baseMs / state.rate;
    if (unit.c === '\\n') return pacing.paragraphMs / state.rate;
    if (PAUSE_HEAVY.test(unit.c)) return pacing.punctuationMs / state.rate;
    if (PAUSE_LIGHT.test(unit.c)) return (pacing.punctuationMs * 0.55) / state.rate;
    if (unit.c === ' ') return base * 0.5;
    if (unit.w >= 2) return base * 1.6;
    return base;
  }

  function contextHtml(at) {
    var before = '', after = '';
    for (var i = Math.max(0, at - 42); i < at; i++) before += tape[i].c === '\\n' ? ' ' : tape[i].c;
    for (var j = at + 1; j < Math.min(tape.length, at + 42); j++) after += tape[j].c === '\\n' ? ' ' : tape[j].c;
    var current = tape[at] ? tape[at].c : '';
    var esc = function (s) { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;'); };
    return '<span class="past">' + esc(before) + '</span><b>' + esc(current) + '</b>' + esc(after);
  }

  function paint() {
    var unit = tape[state.at];
    if (!unit) return finish();
    el.glyph.textContent = unit.c === '\\n' ? '' : unit.c;
    el.charBox.className = 'fb-char' + (unit.w >= 3 ? ' w3' : unit.w === 2 ? ' w2' : '');
    el.ruby.textContent = unit.r && unit.r.reading ? unit.r.reading : '';
    if (unit.r && unit.r.gloss) {
      el.gloss.textContent = unit.r.gloss;
      el.gloss.className = 'fb-gloss on';
    } else if (!unit.r) {
      el.gloss.className = 'fb-gloss';
    }
    el.context.innerHTML = contextHtml(state.at);
    el.title.textContent = KAMU.chapters[unit.ci] ? KAMU.chapters[unit.ci].title : '';
    el.counter.textContent = (state.at + 1) + ' / ' + tape.length;
    el.bar.style.width = ((state.at + 1) / tape.length * 100) + '%';
    Array.prototype.forEach.call(el.chapters.querySelectorAll('button'), function (button, index) {
      button.className = index === unit.ci ? 'on' : '';
    });
  }

  function finish() {
    stop();
    el.glyph.textContent = '';
    el.ruby.textContent = '';
    el.context.innerHTML = '<span class="fb-done">Read to the end. Press 0 to start over.</span>';
  }

  function tick() {
    paint();
    if (!state.playing) return;
    var unit = tape[state.at];
    state.timer = setTimeout(function () {
      state.at++;
      if (state.at >= tape.length) return finish();
      tick();
    }, delayFor(unit || { c: '', w: 0 }));
  }

  function play() {
    if (state.at >= tape.length) state.at = 0;
    state.playing = true;
    el.playHint.textContent = 'pause';
    tick();
  }
  function stop() {
    state.playing = false;
    el.playHint.textContent = 'play';
    clearTimeout(state.timer);
  }
  function toggle() { state.playing ? stop() : play(); }

  function seek(delta) {
    stop();
    state.at = Math.max(0, Math.min(tape.length - 1, state.at + delta));
    paint();
  }
  function gotoChapter(index) {
    var wasPlaying = state.playing;
    stop();
    state.at = chapterStarts[Math.max(0, Math.min(chapterStarts.length - 1, index))] || 0;
    paint();
    if (wasPlaying) play();
  }
  function nudgeRate(factor) {
    state.rate = Math.max(0.15, Math.min(8, state.rate * factor));
    el.speed.textContent = state.rate.toFixed(2) + 'x';
  }

  KAMU.chapters.forEach(function (chapter, index) {
    var button = document.createElement('button');
    button.type = 'button';
    button.textContent = (index + 1) + '. ' + (chapter.title || 'Part ' + (index + 1));
    button.addEventListener('click', function () { gotoChapter(index); });
    el.chapters.appendChild(button);
  });

  document.querySelector('.fb-stage').addEventListener('click', toggle);
  document.addEventListener('keydown', function (event) {
    var step = event.shiftKey ? 20 : 1;
    switch (event.key) {
      case ' ': event.preventDefault(); toggle(); break;
      case 'ArrowRight': event.preventDefault(); seek(step); break;
      case 'ArrowLeft': event.preventDefault(); seek(-step); break;
      case 'ArrowUp': event.preventDefault(); nudgeRate(1.25); break;
      case 'ArrowDown': event.preventDefault(); nudgeRate(0.8); break;
      case ']': gotoChapter(currentChapter() + 1); break;
      case '[': gotoChapter(currentChapter() - 1); break;
      case 'c': el.chapters.classList.toggle('on'); break;
      case '0': stop(); state.at = 0; paint(); break;
      case 'f':
        if (document.fullscreenElement) document.exitFullscreen();
        else document.documentElement.requestFullscreen();
        break;
    }
  });
  function currentChapter() { return tape[state.at] ? tape[state.at].ci : 0; }

  nudgeRate(1);
  paint();
})();
`

export function renderFlipbookHtml(piece: FlipbookPiece, theme: 'dark' | 'light' | 'auto'): string {
  const parts: HtmlParts = {
    styles: STYLES,
    data: piece,
    script: SCRIPT,
    body: `
<div class="fb-head">
  <span class="title">${escapeHtml(piece.title)}</span>
  <span class="chapter"></span>
  <span class="counter"></span>
</div>
<div class="fb-progress"><i></i></div>
<div class="fb-stage">
  <div class="fb-char"><span class="ruby"></span><span class="glyph"></span></div>
  <div class="fb-gloss"></div>
  <div class="fb-context"></div>
</div>
<div class="fb-foot">
  <span><kbd>space</kbd> <span data-hint>play</span></span>
  <span><kbd>←</kbd><kbd>→</kbd> step</span>
  <span><kbd>↑</kbd><kbd>↓</kbd> speed</span>
  <span><kbd>[</kbd><kbd>]</kbd> chapter</span>
  <span><kbd>c</kbd> contents</span>
  <span><kbd>f</kbd> fullscreen</span>
  <span class="speed">1.00x</span>
</div>
<nav class="fb-chapters"><h2>Chapters</h2></nav>
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
