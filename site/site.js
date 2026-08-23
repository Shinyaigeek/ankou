// Three small things: the theme toggle, copy buttons on code blocks, and the
// intent chooser in the hero. No dependencies, and every one of them is
// optional — the page reads fine with the script blocked.
;(() => {
  const root = document.documentElement
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches

  /* Theme. The key is shared with the pages ankou renders, so a demo iframe
     loaded after a toggle comes up in the same theme as the site. */
  const toggle = document.querySelector('[data-theme-toggle]')
  toggle?.addEventListener('click', () => {
    const dark =
      root.getAttribute('data-theme') === 'dark' ||
      (!root.hasAttribute('data-theme') && matchMedia('(prefers-color-scheme: dark)').matches)
    const next = dark ? 'light' : 'dark'
    root.setAttribute('data-theme', next)
    try {
      localStorage.setItem('ankou-theme', next)
    } catch {}
  })

  /* Copy buttons, added here rather than in the markup so a block is just a
     <pre> in the source. */
  for (const block of document.querySelectorAll('.code')) {
    const pre = block.querySelector('pre')
    if (!pre || !navigator.clipboard) continue
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'copy'
    button.textContent = 'copy'
    button.addEventListener('click', async () => {
      // Comment markers are decoration; the shell should get the plain text.
      await navigator.clipboard.writeText(pre.innerText.trim())
      button.textContent = 'copied'
      setTimeout(() => {
        button.textContent = 'copy'
      }, 1400)
    })
    block.append(button)
  }

  /* The intent chooser: type an intent out one character at a time — the
     flipbook's own trick — then show the shape ankou would pick for it. */
  const stage = document.querySelector('[data-chooser]')
  if (!stage) return

  const chips = [...stage.querySelectorAll('.chip')]
  const line = stage.querySelector('[data-intent-line]')
  const result = stage.querySelector('[data-result]')
  const formatEl = stage.querySelector('[data-format]')
  const whyEl = stage.querySelector('[data-why]')
  const linkEl = stage.querySelector('[data-demo-link]')
  if (!chips.length || !line || !result) return

  let timer
  let rotating = !reduced
  let index = 0

  const show = (chip, animate) => {
    clearTimeout(timer)
    for (const other of chips) other.setAttribute('aria-pressed', String(other === chip))
    index = chips.indexOf(chip)

    const intent = chip.dataset.intent ?? ''
    const commit = () => {
      result.hidden = false
      formatEl.textContent = chip.dataset.format ?? ''
      whyEl.textContent = chip.dataset.why ?? ''
      linkEl.href = chip.dataset.demo ?? '#'
      linkEl.textContent = `see a ${chip.dataset.format} →`
      if (rotating) {
        timer = setTimeout(() => show(chips[(index + 1) % chips.length], true), 4200)
      }
    }

    if (!animate) {
      line.textContent = intent
      commit()
      return
    }

    result.hidden = true
    const characters = [...intent]
    let at = 0
    const tick = () => {
      line.textContent = characters.slice(0, at).join('')
      line.insertAdjacentHTML('beforeend', '<span class="caret">▍</span>')
      if (at++ < characters.length) {
        // Punctuation gets a longer beat, the way the flipbook paces it.
        const last = characters[at - 1] ?? ''
        timer = setTimeout(tick, /[、。,.!?]/.test(last) ? 260 : 52)
      } else {
        line.textContent = intent
        timer = setTimeout(commit, 350)
      }
    }
    tick()
  }

  for (const chip of chips) {
    chip.addEventListener('click', () => {
      rotating = false // A reader who picked one is not waiting for a carousel.
      show(chip, !reduced)
    })
  }

  show(chips[0], !reduced)
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) clearTimeout(timer)
    else if (rotating) show(chips[index], false)
  })
})()
