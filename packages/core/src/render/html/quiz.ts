import type { QuizPiece } from '../../types.js'
import { escapeHtml } from '../../util/text.js'
import { type HtmlParts, htmlDocument, READ_DATA } from './shell.js'

const STYLES = `
.qz-wrap { max-width: 46rem; margin: 0 auto; padding: 3.5rem 1.4rem 2rem; }
.qz-wrap > header { margin-bottom: 2.4rem; }
.qz-wrap h1 { font-size: clamp(1.5rem, 4vw, 2.2rem); margin: 0 0 .4rem; letter-spacing: -.02em; }
.qz-wrap .sub { color: var(--fg-muted); font-size: .92rem; margin: 0; }
.qz-q {
  background: var(--bg-raised); border: 1px solid var(--border); border-radius: var(--radius);
  padding: 1.3rem 1.4rem; margin-bottom: 1.1rem; box-shadow: var(--shadow);
}
.qz-q > .no { font-size: .72rem; letter-spacing: .12em; text-transform: uppercase; color: var(--fg-faint); }
.qz-q > .no .diff { color: var(--accent); margin-left: .6rem; letter-spacing: 0; }
.qz-q > .prompt { font-size: 1.06rem; font-weight: 560; margin: .35rem 0 1rem; line-height: 1.5; }
.qz-choices { display: grid; gap: .5rem; }
.qz-choice {
  display: flex; gap: .7rem; align-items: flex-start; text-align: left;
  border: 1px solid var(--border); border-radius: 10px; background: var(--bg);
  padding: .7rem .85rem; cursor: pointer; line-height: 1.5;
}
.qz-choice:hover { border-color: var(--accent); }
.qz-choice input { margin: .35rem 0 0; accent-color: var(--accent); flex: none; }
.qz-choice .key { font-family: var(--font-mono); color: var(--fg-faint); flex: none; }
.qz-choice.correct { border-color: #16a34a; background: color-mix(in srgb, #16a34a 12%, transparent); }
.qz-choice.wrong { border-color: #dc2626; background: color-mix(in srgb, #dc2626 12%, transparent); }
.qz-short input[type=text] {
  width: 100%; font: inherit; padding: .6rem .8rem; border-radius: 10px;
  border: 1px solid var(--border); background: var(--bg); color: inherit;
}
.qz-feedback { display: none; margin-top: 1rem; border-top: 1px solid var(--border); padding-top: .9rem; }
.qz-feedback.on { display: block; }
.qz-verdict { font-weight: 650; font-size: .92rem; margin-bottom: .4rem; }
.qz-verdict.ok { color: #16a34a; }
.qz-verdict.no { color: #dc2626; }
.qz-explain { color: var(--fg-muted); font-size: .93rem; margin: 0 0 .6rem; }
.qz-evidence {
  font-family: var(--font-serif); font-size: .9rem; color: var(--fg-muted);
  border-left: 3px solid var(--border); padding-left: .9rem; margin: 0;
}
.qz-actions { display: flex; gap: .7rem; align-items: center; flex-wrap: wrap; margin: 1.8rem 0 0; }
.qz-actions .primary { background: var(--accent); border-color: var(--accent); color: #fff; font-weight: 600; }
.qz-score {
  display: none; margin-top: 1.6rem; padding: 1.4rem; border-radius: var(--radius);
  border: 1px solid var(--border); background: var(--bg-raised); text-align: center;
}
.qz-score.on { display: block; }
.qz-score b { display: block; font-size: 2.6rem; color: var(--accent); line-height: 1.1; letter-spacing: -.03em; }
.qz-score span { color: var(--fg-muted); font-size: .92rem; }
`

const SCRIPT = `
${READ_DATA}
(function () {
  var root = document.querySelector('.qz-list');
  var scored = false;

  function normalise(value) {
    return String(value).trim().toLowerCase()
      .replace(/[\\s\\u3000]+/g, '')
      .replace(/[.,。、!！?？"'"'']/g, '');
  }

  ANKOU.questions.forEach(function (question, index) {
    var card = document.createElement('section');
    card.className = 'qz-q';
    var stars = '●'.repeat(question.difficulty) + '○'.repeat(3 - question.difficulty);
    var head = document.createElement('div');
    head.className = 'no';
    head.innerHTML = 'Q' + (index + 1) + ' <span class="diff">' + stars + '</span>';
    var prompt = document.createElement('p');
    prompt.className = 'prompt';
    prompt.textContent = question.prompt;
    card.appendChild(head);
    card.appendChild(prompt);

    if (question.kind === 'short') {
      var shortBox = document.createElement('div');
      shortBox.className = 'qz-short';
      var input = document.createElement('input');
      input.type = 'text';
      input.setAttribute('aria-label', question.prompt);
      shortBox.appendChild(input);
      card.appendChild(shortBox);
      card.__answer = function () { return [input.value]; };
      card.__lock = function () { input.disabled = true; };
    } else {
      var list = document.createElement('div');
      list.className = 'qz-choices';
      var inputs = [];
      (question.choices || []).forEach(function (choice) {
        var label = document.createElement('label');
        label.className = 'qz-choice';
        var input = document.createElement('input');
        input.type = question.kind === 'multi' ? 'checkbox' : 'radio';
        input.name = question.id;
        input.value = choice.id;
        var key = document.createElement('span');
        key.className = 'key';
        key.textContent = choice.id + '.';
        var text = document.createElement('span');
        text.textContent = choice.text;
        label.appendChild(input); label.appendChild(key); label.appendChild(text);
        list.appendChild(label);
        inputs.push({ input: input, label: label, id: choice.id });
      });
      card.appendChild(list);
      card.__answer = function () {
        return inputs.filter(function (i) { return i.input.checked; }).map(function (i) { return i.id; });
      };
      card.__lock = function () {
        inputs.forEach(function (i) {
          i.input.disabled = true;
          if (question.answer.indexOf(i.id) >= 0) i.label.classList.add('correct');
          else if (i.input.checked) i.label.classList.add('wrong');
        });
      };
    }

    var feedback = document.createElement('div');
    feedback.className = 'qz-feedback';
    feedback.innerHTML =
      '<div class="qz-verdict"></div><p class="qz-explain"></p>' +
      (question.evidence ? '<blockquote class="qz-evidence"></blockquote>' : '');
    feedback.querySelector('.qz-explain').textContent = question.explanation || '';
    if (question.evidence) feedback.querySelector('.qz-evidence').textContent = question.evidence;
    card.appendChild(feedback);
    root.appendChild(card);

    card.__grade = function () {
      var given = card.__answer().map(normalise).filter(Boolean).sort();
      var want = question.answer.map(normalise).sort();
      var ok = question.kind === 'short'
        ? given.length > 0 && want.some(function (w) { return given.indexOf(w) >= 0; })
        : given.length === want.length && given.every(function (value, i) { return value === want[i]; });
      var verdict = feedback.querySelector('.qz-verdict');
      verdict.className = 'qz-verdict ' + (ok ? 'ok' : 'no');
      verdict.textContent = ok
        ? 'Correct'
        : 'Not quite — answer: ' + question.answer.join(', ');
      feedback.classList.add('on');
      card.__lock();
      return ok;
    };
  });

  var button = document.querySelector('.qz-actions .primary');
  var retry = document.querySelector('.qz-actions .retry');
  var score = document.querySelector('.qz-score');

  button.addEventListener('click', function () {
    if (scored) return;
    scored = true;
    var cards = Array.prototype.slice.call(root.children);
    var right = cards.filter(function (card) { return card.__grade(); }).length;
    score.querySelector('b').textContent = right + ' / ' + cards.length;
    score.querySelector('span').textContent = right >= ANKOU.passScore
      ? 'It stuck. ' + ANKOU.passScore + ' was the bar.'
      : 'Worth another pass — the bar was ' + ANKOU.passScore + '.';
    score.classList.add('on');
    button.disabled = true;
    retry.hidden = false;
    score.scrollIntoView({ behavior: 'smooth', block: 'center' });
  });
  retry.addEventListener('click', function () { location.reload(); });
})();
`

export function renderQuizHtml(piece: QuizPiece, theme: 'dark' | 'light' | 'auto'): string {
  const parts: HtmlParts = {
    styles: STYLES,
    data: piece,
    script: SCRIPT,
    body: `
<main class="qz-wrap">
  <header>
    <h1>${escapeHtml(piece.title)}</h1>
    <p class="sub">${piece.questions.length} questions · pass mark ${piece.passScore}</p>
  </header>
  <div class="qz-list"></div>
  <div class="qz-actions ankou-no-print">
    <button type="button" class="primary">Check answers</button>
    <button type="button" class="retry" hidden>Try again</button>
  </div>
  <div class="qz-score"><b></b><span></span></div>
</main>
`,
  }
  return htmlDocument(
    { title: piece.title, lang: piece.lang, subtitle: piece.meta.sources[0]?.title, theme },
    parts,
  )
}
