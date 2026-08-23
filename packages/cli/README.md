# ankou

Feed it markdown, text, HTML, PDFs or URLs, say what you want out of them, and
read the result as a flipbook, a deck, a quiz, an animation or a summary.

```sh
npm i -g ankou

ankou spec.md --intent "一字一句漏らさず頭に入れたい"
ankou https://example.com/post --intent "I need to remember this" --play
ankou paper.pdf notes.md --intent "explain it to me like I have never seen it"
```

Needs a model: `ANTHROPIC_API_KEY`, or `--provider claude-code` for a Claude Code
subscription, `--provider openai` for anything OpenAI-compatible, or
`--provider ollama` to stay local.

`ankou --help` for the flags, `ankou formats` for what it can make.

Full documentation: <https://github.com/Shinyaigeek/ankou>

MIT
