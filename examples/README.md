# Examples

`gallery.mjs` renders one HTML page per format from a fixed, hand-written piece —
no API key and no model call. It exists for two reasons:

- to see what each format actually looks like before you spend a token on it,
- to show the shape of a custom `LLM`, since the pipeline takes any object that
  implements `complete` and (optionally) `structured`.

```sh
pnpm build
node examples/gallery.mjs        # writes examples/out/*.html
```

`sdk.mjs` is the smallest real usage: one source, one intent, one file out.
