import { escapeHtml, escapeJson } from '../../util/text.js'

export interface HtmlParts {
  styles: string
  body: string
  /** Client script. Written without template literals so it survives inlining. */
  script?: string
  /** Serialised into a `<script type="application/json">` island. */
  data?: unknown
}

const DARK_TOKENS = `  --bg: #14130f;
  --bg-raised: #1e1c17;
  --bg-sunken: #0d0c0a;
  --fg: #f2efe6;
  --fg-muted: #a8a294;
  --fg-faint: #6b6759;
  --accent: #f97316;
  --accent-soft: #3a2413;
  --border: #302d25;
  --shadow: 0 1px 2px rgba(0, 0, 0, .4), 0 8px 32px rgba(0, 0, 0, .35);`

/**
 * Shared design tokens.
 *
 * Everything kamu emits is a single file with no network dependencies, so the
 * palette, the type scale and the theme switch all live here rather than in a
 * stylesheet the reader would have to keep next to the HTML.
 */
const BASE_STYLES = `
:root {
  color-scheme: light dark;
  --bg: #fbfaf7;
  --bg-raised: #ffffff;
  --bg-sunken: #f0eee8;
  --fg: #1b1a17;
  --fg-muted: #6b6759;
  --fg-faint: #a8a294;
  --accent: #c2410c;
  --accent-soft: #fde9d7;
  --border: #e3ded2;
  --shadow: 0 1px 2px rgba(27, 26, 23, .06), 0 8px 24px rgba(27, 26, 23, .06);
  --radius: 14px;
  --font: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto,
    "Hiragino Sans", "Noto Sans JP", "Yu Gothic UI", Meiryo, sans-serif;
  --font-serif: ui-serif, Georgia, "Hiragino Mincho ProN", "Yu Mincho", serif;
  --font-mono: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
}
/* Dark applies two ways: because the reader's system asks for it, or because
   they picked it here. Without the media query the first case swallows the
   second — an unset preference is not a request for dark. */
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
${DARK_TOKENS}
  }
}
:root[data-theme="dark"] {
${DARK_TOKENS}
}
:root[data-theme="light"] {
  --bg: #fbfaf7;
  --bg-raised: #ffffff;
  --bg-sunken: #f0eee8;
  --fg: #1b1a17;
  --fg-muted: #6b6759;
  --fg-faint: #a8a294;
  --accent: #c2410c;
  --accent-soft: #fde9d7;
  --border: #e3ded2;
  --shadow: 0 1px 2px rgba(27, 26, 23, .06), 0 8px 24px rgba(27, 26, 23, .06);
}
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body {
  background: var(--bg);
  color: var(--fg);
  font-family: var(--font);
  line-height: 1.7;
  -webkit-font-smoothing: antialiased;
  overflow-wrap: anywhere;
}
a { color: var(--accent); }
:focus-visible { outline: 2px solid var(--accent); outline-offset: 3px; border-radius: 4px; }
button {
  font: inherit;
  color: inherit;
  background: var(--bg-raised);
  border: 1px solid var(--border);
  border-radius: 999px;
  padding: .4em 1em;
  cursor: pointer;
  transition: background .15s ease, border-color .15s ease;
}
button:hover { border-color: var(--accent); }
button[disabled] { opacity: .5; cursor: default; }
code, pre { font-family: var(--font-mono); font-size: .9em; }
pre {
  background: var(--bg-sunken);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 1rem 1.1rem;
  overflow-x: auto;
}
.kamu-topbar {
  position: fixed; top: 0; right: 0; z-index: 50;
  display: flex; gap: .4rem; align-items: center;
  padding: .7rem .9rem;
}
.kamu-topbar button { padding: .3em .8em; font-size: .8rem; opacity: .55; }
.kamu-topbar button:hover { opacity: 1; }
.kamu-credit {
  color: var(--fg-faint); font-size: .74rem; letter-spacing: .04em;
  padding: 3rem 1.5rem 2rem; text-align: center;
}
.kamu-credit b { font-weight: 600; color: var(--fg-muted); }
.kamu-scroll { overflow-x: auto; max-width: 100%; }
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { animation-duration: .001ms !important; transition-duration: .001ms !important; }
}
@media print {
  .kamu-topbar, .kamu-no-print { display: none !important; }
  body { background: #fff; color: #000; }
}
`

/*
 * Runs in <head>, before anything is painted.
 *
 * At the end of <body> it was too late: on a page of any size the browser had
 * already painted a screenful in the system theme, and the reader's stored
 * choice arrived after. Measured on a 190KB summary — a dark frame at 1951
 * nodes, the stored light theme at 2489.
 */
const THEME_SCRIPT = `
(function () {
  var root = document.documentElement;
  var KEY = 'kamu-theme';
  try {
    var saved = localStorage.getItem(KEY);
    if (saved === 'dark' || saved === 'light') root.setAttribute('data-theme', saved);
  } catch (e) {}
  window.kamuToggleTheme = function () {
    var isDark = root.getAttribute('data-theme') === 'dark' ||
      (!root.hasAttribute('data-theme') && matchMedia('(prefers-color-scheme: dark)').matches);
    var next = isDark ? 'light' : 'dark';
    root.setAttribute('data-theme', next);
    try { localStorage.setItem(KEY, next); } catch (e) {}
  };
})();
`

export interface ShellOptions {
  title: string
  lang: string
  /** Shown in the footer credit line. */
  subtitle?: string
  theme?: 'dark' | 'light' | 'auto'
  /** Extra buttons for the floating top bar, as HTML. */
  controls?: string
  /**
   * Layouts that own the whole viewport (flipbook, slides, animation) drop the
   * footer credit: a line of text below the fold would fight the player for it.
   */
  fullBleed?: boolean
}

export function htmlDocument(options: ShellOptions, parts: HtmlParts): string {
  const themeAttr =
    options.theme && options.theme !== 'auto' ? ` data-theme="${options.theme}"` : ''
  const dataIsland =
    parts.data === undefined
      ? ''
      : `<script id="kamu-data" type="application/json">${escapeJson(parts.data)}</script>`

  return `<!doctype html>
<html lang="${escapeHtml(options.lang)}"${themeAttr}>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="generator" content="kamu">
<script>${THEME_SCRIPT}</script>
<title>${escapeHtml(options.title)}</title>
<style>${BASE_STYLES}${parts.styles}</style>
</head>
<body>
<div class="kamu-topbar kamu-no-print">
${options.controls ?? ''}
<button type="button" onclick="window.kamuToggleTheme()" aria-label="Toggle colour theme" title="Toggle theme">◐</button>
</div>
${parts.body}
${
  options.fullBleed
    ? ''
    : `<p class="kamu-credit">${escapeHtml(options.subtitle ?? '')}${
        options.subtitle ? ' · ' : ''
      }chewed by <b>kamu</b></p>`
}
${dataIsland}
${parts.script ? `<script>${parts.script}</script>` : ''}
</body>
</html>
`
}

/** Read the embedded JSON island. Prepended to every client script that needs it. */
export const READ_DATA = `
var KAMU = JSON.parse(document.getElementById('kamu-data').textContent);
`
