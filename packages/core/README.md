# ankou-core

The engine behind [ankou](https://github.com/Shinyaigeek/ankou): carve documents
(markdown, text, HTML, PDF, URL) into the shape you actually want to read them
in — flipbooks, slides, quizzes, kinetic animations, summaries, dialogues.

```sh
npm i ankou-core
```

```ts
import { carveAndRender } from 'ankou-core'

const { piece, plan, output } = await carveAndRender({
  sources: ['./spec.md', 'https://example.com/post'],
  intent: '一字一句漏らさず頭に入れたい',
  renderer: 'html',
})
```

ESM, Node 22+, **no runtime dependencies**. PDF support (`unpdf`) and the
Claude Code provider (`@anthropic-ai/claude-agent-sdk`) are optional peers,
imported lazily.

Full documentation: [SDK guide](https://github.com/Shinyaigeek/ankou/blob/main/docs/SDK.md)
· [architecture](https://github.com/Shinyaigeek/ankou/blob/main/docs/ARCHITECTURE.md)
· [formats](https://github.com/Shinyaigeek/ankou/blob/main/docs/FORMATS.md)

MIT
