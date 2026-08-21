# Security Policy

## Supported versions

kamu is pre-1.0. Fixes land on the latest `0.x`; there is no backport window.
Please test against the newest published version before reporting.

## Reporting a vulnerability

**Please do not open a public GitHub issue for security problems.**

Use GitHub's [private vulnerability reporting](https://github.com/Shinyaigeek/kamu/security/advisories/new).
Expect an acknowledgement within a few days.

Include what you would want to receive: affected version, a reproduction, and
what an attacker gets out of it.

## Threat model

kamu fetches remote documents, feeds them to a language model, and writes an HTML
file. That shapes what counts as a vulnerability here.

**In scope**

- Escaping bugs in the HTML renderers — content from a source or a model landing
  in the page unescaped.
- Path traversal or unexpected writes through `--out`.
- Sending source content anywhere other than the configured provider.
- The HTML parser or the PDF reflow being made to hang or blow the stack on
  crafted input.

**Not in scope**

- A model producing wrong, biased or unpleasant output. kamu constrains shape,
  not truth.
- Prompt injection from a fetched document influencing what the model writes.
  Treat generated pieces as untrusted content — which is why the renderers escape
  everything, including model output.
- Anything requiring the attacker to already control the machine kamu runs on.

## Notes for operators

- kamu sends the text of every source you give it to the configured provider.
  With `--provider ollama` nothing leaves the machine.
- Generated HTML is self-contained and makes no network requests, but it is still
  a page built from untrusted text. Serving it from an origin that matters means
  it can reach that origin's storage; give it its own.
