import type { AnimationPiece } from '../../types.js'
import { type HtmlParts, htmlDocument, READ_DATA } from './shell.js'

const STYLES = `
body { height: 100dvh; overflow: hidden; background: var(--bg-sunken); }
.an-stage {
  position: relative; height: 100dvh; display: flex; align-items: center; justify-content: center;
  padding: clamp(1.5rem, 8vmin, 6rem); cursor: pointer; overflow: hidden;
  transition: background .6s ease, color .6s ease;
}
.an-stage[data-mood="calm"] { background: var(--bg); }
.an-stage[data-mood="bright"] { background: linear-gradient(140deg, var(--accent-soft), var(--bg)); }
.an-stage[data-mood="tense"] { background: radial-gradient(120% 90% at 50% 20%, var(--bg-raised), var(--bg-sunken)); }
.an-stage[data-mood="dark"] { background: #0a0a0a; color: #f5f5f5; }
.an-scene { display: flex; flex-direction: column; gap: .5em; align-items: center; text-align: center; max-width: min(90vw, 56rem); }
.an-line { font-weight: 620; letter-spacing: -.02em; line-height: 1.25; opacity: 0; }
.an-line[data-scale="sm"] { font-size: clamp(1rem, 3.2vmin, 1.6rem); font-weight: 500; }
.an-line[data-scale="md"] { font-size: clamp(1.4rem, 5vmin, 2.6rem); }
.an-line[data-scale="lg"] { font-size: clamp(2rem, 8vmin, 4.4rem); }
.an-line[data-scale="xl"] { font-size: clamp(2.6rem, 12vmin, 7rem); font-weight: 700; }
.an-line.accent { color: var(--accent); }
.an-line.go { opacity: 1; }
.m-fade .an-line.go { animation: anFade var(--dur) ease both; }
.m-slide-up .an-line.go { animation: anUp var(--dur) cubic-bezier(.2,.8,.2,1) both; }
.m-zoom .an-line.go { animation: anZoom var(--dur) cubic-bezier(.2,.9,.2,1) both; }
.m-stagger .an-line.go { animation: anUp var(--dur) cubic-bezier(.2,.8,.2,1) both; }
.m-flip .an-line.go { animation: anFlip var(--dur) cubic-bezier(.3,.7,.2,1) both; transform-origin: 50% 50%; }
.m-typewriter .an-line.go { animation: none; opacity: 1; }
.m-typewriter .an-line.go::after {
  content: ''; display: inline-block; width: .08em; height: 1em; margin-left: .06em;
  background: currentColor; animation: anCaret .9s steps(1) infinite; vertical-align: -.1em;
}
@keyframes anFade { from { opacity: 0; } to { opacity: 1; } }
@keyframes anUp { from { opacity: 0; transform: translateY(.6em); } to { opacity: 1; transform: none; } }
@keyframes anZoom { from { opacity: 0; transform: scale(.72); } to { opacity: 1; transform: none; } }
@keyframes anFlip { from { opacity: 0; transform: rotateX(85deg); } to { opacity: 1; transform: none; } }
@keyframes anCaret { 50% { opacity: 0; } }
.an-progress { position: fixed; left: 0; right: 0; bottom: 0; height: 3px; background: rgba(128,128,128,.2); }
.an-progress i { display: block; height: 100%; width: 0; background: var(--accent); transition: width .25s linear; }
.an-hint {
  position: fixed; left: 50%; bottom: 1.4rem; transform: translateX(-50%);
  font-size: .74rem; color: var(--fg-faint); letter-spacing: .06em; pointer-events: none;
  transition: opacity .4s ease;
}
.an-hint.hide { opacity: 0; }
`

const SCRIPT = `
${READ_DATA}
(function () {
  var stage = document.querySelector('.an-stage');
  var progress = document.querySelector('.an-progress i');
  var hint = document.querySelector('.an-hint');
  var scenes = KAMU.scenes || [];
  var at = -1, playing = true, timer = null;

  function typewrite(node, text, duration) {
    var chars = Array.from(text);
    var step = Math.max(16, duration / Math.max(chars.length, 1));
    var i = 0;
    node.textContent = '';
    (function next() {
      if (i >= chars.length) return;
      node.textContent += chars[i++];
      timerType = setTimeout(next, step);
    })();
  }
  var timerType = null;

  function show(index) {
    clearTimeout(timer); clearTimeout(timerType);
    at = index;
    if (at >= scenes.length) { at = scenes.length - 1; playing = false; }
    if (at < 0) at = 0;
    var scene = scenes[at];
    stage.setAttribute('data-mood', scene.mood || 'calm');
    stage.className = 'an-stage m-' + (scene.motion || 'fade');
    stage.innerHTML = '';

    var box = document.createElement('div');
    box.className = 'an-scene';
    stage.appendChild(box);

    var stagger = scene.motion === 'stagger';
    scene.lines.forEach(function (line, i) {
      var node = document.createElement('div');
      node.className = 'an-line' + (line.accent ? ' accent' : '');
      node.setAttribute('data-scale', line.scale || 'md');
      node.style.setProperty('--dur', scene.durationMs + 'ms');
      box.appendChild(node);
      var start = stagger ? i * Math.max(120, scene.durationMs * 0.45) : 0;
      setTimeout(function () {
        node.classList.add('go');
        if (scene.motion === 'typewriter') typewrite(node, line.text, scene.durationMs);
        else node.textContent = line.text;
      }, start);
      if (scene.motion !== 'typewriter') node.textContent = line.text;
    });

    progress.style.width = ((at + 1) / scenes.length * 100) + '%';
    if (playing) {
      var total = scene.durationMs + scene.holdMs +
        (stagger ? scene.lines.length * scene.durationMs * 0.45 : 0);
      timer = setTimeout(function () {
        if (at + 1 >= scenes.length) { playing = false; return; }
        show(at + 1);
      }, total);
    }
  }

  function toggle() {
    playing = !playing;
    hint.classList.toggle('hide', playing);
    if (playing) show(at + 1 >= scenes.length ? 0 : at); else clearTimeout(timer);
  }

  stage.addEventListener('click', toggle);
  document.addEventListener('keydown', function (event) {
    switch (event.key) {
      case ' ': event.preventDefault(); toggle(); break;
      case 'ArrowRight': playing = false; clearTimeout(timer); show(at + 1); break;
      case 'ArrowLeft': playing = false; clearTimeout(timer); show(at - 1); break;
      case '0': playing = true; show(0); break;
      case 'f':
        if (document.fullscreenElement) document.exitFullscreen();
        else document.documentElement.requestFullscreen();
        break;
    }
  });

  setTimeout(function () { hint.classList.add('hide'); }, 2600);
  show(0);
})();
`

export function renderAnimationHtml(
  piece: AnimationPiece,
  theme: 'dark' | 'light' | 'auto',
): string {
  const parts: HtmlParts = {
    styles: STYLES,
    data: piece,
    script: SCRIPT,
    body: `
<div class="an-stage m-fade" data-mood="calm"></div>
<div class="an-hint">click or press space to pause · ← → to step</div>
<div class="an-progress"><i></i></div>
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
