// Build-time syntax highlighting for the code blocks on the site.
//
// A highlighter is a lot of bytes to ship for text that never changes, so this
// one runs once, here, and the browser gets plain spans. No dependency either:
// the site has four languages in it, and a table of regexes covers all four.
//
// Every rule is tried in order at the current position; the first that matches
// wins, and anything nothing matches is copied through as plain text.

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", '#39': "'" }

const decode = (text) => text.replace(/&(amp|lt|gt|quot|apos|#39);/g, (_, name) => ENTITIES[name])

const encode = (text) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/* A `#` only starts a comment when something separates it from a word — `qwen3:8b`
   is not a comment, and neither is a fragment in a URL. */
const afterSpace = (src, pos) => pos === 0 || /[\s(;|&]/.test(src[pos - 1])

/* The first word of a line is the program being run — and so is the first word
   after a prompt, a pipe, or a `&&`. Indented lines are continuations or printed
   output, so they are left alone: only a prompt earns a command after a margin. */
const atCommand = (src, pos) =>
  /(?:^|\n)(?:[ \t]*\$[ \t]+)?$|(?:[;|]|&&|\|\|)[ \t]*$/.test(src.slice(0, pos))

/* Shell, and the transcripts of shell output that read the same way. */
const SHELL = [
  { cls: 'comment', re: /#[^\n]*/my, when: afterSpace },
  { cls: 'string', re: /"(?:\\.|[^"\\\n])*"?/my },
  { cls: 'string', re: /'(?:\\.|[^'\\\n])*'?/my },
  { cls: 'string', re: /`[^`\n]*`/my },
  { cls: 'op', re: /^\$(?=[ \t])/my },
  { cls: 'var', re: /\$\{[^}\n]*\}|\$[A-Za-z_]\w*/my },
  // Environment variables, and only those: `RFC.md` is a file, not a variable.
  { cls: 'var', re: /\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b/my },
  { cls: 'flag', re: /--?[A-Za-z][\w-]*/my, when: afterSpace },
  { cls: 'cmd', re: /[A-Za-z_][\w./-]*/my, when: atCommand },
  { cls: 'ok', re: /[✓→←]/my },
  // `>` is a redirect only with space around it; inside `<source>` it is a word.
  { cls: 'op', re: /&&|\|\||[|·]|>>(?=\s)|>(?=\s)/my, when: afterSpace },
]

const TS = [
  { cls: 'comment', re: /\/\/[^\n]*/my },
  { cls: 'comment', re: /\/\*[\s\S]*?\*\//my },
  { cls: 'string', re: /'(?:\\.|[^'\\\n])*'/my },
  { cls: 'string', re: /"(?:\\.|[^"\\\n])*"/my },
  { cls: 'string', re: /`(?:\\.|[^`\\])*`/my },
  {
    cls: 'keyword',
    re: /\b(?:as|async|await|break|case|catch|class|const|continue|default|delete|do|else|enum|export|extends|for|from|function|if|import|in|instanceof|interface|let|new|of|return|switch|this|throw|try|type|typeof|var|void|while|yield)\b/my,
  },
  { cls: 'literal', re: /\b(?:true|false|null|undefined)\b/my },
  { cls: 'number', re: /\b\d+(?:\.\d+)?\b/my },
  { cls: 'type', re: /\b[A-Z][A-Za-z0-9_]*\b/my },
  { cls: 'fn', re: /\b[A-Za-z_$][\w$]*(?=\s*\()/my },
  { cls: 'key', re: /\b[A-Za-z_$][\w$]*(?=\s*:)/my },
]

/* JSON with comments: the config files this site shows are read by hosts that
   allow them, and the examples say more with a comment in them. */
const JSONC = [
  { cls: 'comment', re: /\/\/[^\n]*/my },
  { cls: 'key', re: /"(?:\\.|[^"\\\n])*"(?=\s*:)/my },
  { cls: 'string', re: /"(?:\\.|[^"\\\n])*"/my },
  { cls: 'number', re: /-?\b\d+(?:\.\d+)?\b/my },
  { cls: 'literal', re: /\b(?:true|false|null)\b/my },
]

/* The MCP call-and-response transcript: not a language, but it has tool names,
   arrows and payloads, and colouring those three is the whole point of it. */
const TRACE = [
  { cls: 'comment', re: /\/\/[^\n]*/my },
  { cls: 'cmd', re: /^ankou_\w+/my },
  { cls: 'string', re: /"(?:\\.|[^"\\\n])*"/my },
  { cls: 'ok', re: /[→←]/my },
  { cls: 'key', re: /\b[A-Za-z_$][\w$]*(?=\s*:)/my },
  { cls: 'number', re: /\b\d+\b/my },
]

export const LANGUAGES = {
  sh: SHELL,
  // Terminal output rather than something you type, but it reads the same.
  console: SHELL,
  ts: TS,
  json: JSONC,
  trace: TRACE,
}

const tokenize = (src, rules) => {
  let out = ''
  let plain = ''
  let pos = 0
  while (pos < src.length) {
    let hit
    for (const rule of rules) {
      rule.re.lastIndex = pos
      const match = rule.re.exec(src)
      if (!match || match[0] === '') continue
      if (rule.when && !rule.when(src, pos)) continue
      hit = { cls: rule.cls, text: match[0] }
      break
    }
    if (!hit) {
      plain += src[pos]
      pos += 1
      continue
    }
    if (plain) {
      out += encode(plain)
      plain = ''
    }
    out += `<span class="t-${hit.cls}">${encode(hit.text)}</span>`
    pos += hit.text.length
  }
  return out + encode(plain)
}

const MARKUP = /<span class="[\w-]+">[\s\S]*?<\/span>/g

/**
 * Highlight the inner HTML of one `<code>`. Spans already in the source are
 * emphasis the author put there by hand — they are left exactly as they are,
 * and only the text around them is tokenized.
 */
export const highlight = (html, lang) => {
  const rules = LANGUAGES[lang]
  if (!rules) throw new Error(`Unknown code language: ${lang}`)
  let out = ''
  let last = 0
  for (const match of html.matchAll(MARKUP)) {
    out += tokenize(decode(html.slice(last, match.index)), rules)
    out += match[0]
    last = match.index + match[0].length
  }
  return out + tokenize(decode(html.slice(last)), rules)
}
