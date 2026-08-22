# @shinyaigeek/kamu-core

The engine behind [kamu](https://github.com/Shinyaigeek/kamu): chew documents
(markdown, text, HTML, PDF, URL) into the shape you actually want to read them
in — flipbooks, slides, quizzes, kinetic animations, summaries, dialogues.

```sh
npm i @shinyaigeek/kamu-core
```

```ts
import { chewAndRender } from '@shinyaigeek/kamu-core'

const { piece, plan, output } = await chewAndRender({
  sources: ['./spec.md', 'https://example.com/post'],
  intent: '一字一句漏らさず頭に入れたい',
  renderer: 'html',
})
```

ESM, Node 22+, **no runtime dependencies**. PDF support (`unpdf`) and the
Claude Code provider (`@anthropic-ai/claude-agent-sdk`) are optional peers,
imported lazily.

Full documentation: [SDK guide](https://github.com/Shinyaigeek/kamu/blob/main/docs/SDK.md)
· [architecture](https://github.com/Shinyaigeek/kamu/blob/main/docs/ARCHITECTURE.md)
· [formats](https://github.com/Shinyaigeek/kamu/blob/main/docs/FORMATS.md)

MIT
