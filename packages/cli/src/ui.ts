import { term } from 'ankou-core'

const { ansi, palette, paint } = term

const CLEAR_LINE = '\r\u001b[2K'

export interface Ui {
  colour: boolean
  info(message: string): void
  step(message: string): void
  done(message: string): void
  warn(message: string): void
  error(message: string, hint?: string): void
  spinner(message: string): { update(message: string): void; stop(): void }
}

const FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']

export function createUi(quiet: boolean): Ui {
  const stream = process.stderr
  const colour = term.supportsColour(stream)
  const c = (text: string, ...codes: string[]) => (colour ? paint(text, ...codes) : text)
  const write = (line: string) => {
    if (!quiet) stream.write(`${line}\n`)
  }

  return {
    colour,
    info: (message) => write(c(message, palette.muted)),
    step: (message) => write(`${c('·', palette.accent)} ${message}`),
    done: (message) => write(`${c('✓', palette.ok)} ${message}`),
    warn: (message) => stream.write(`${c('!', palette.accent)} ${message}\n`),
    error: (message, hint) => {
      stream.write(`${c('✗', palette.bad)} ${message}\n`)
      if (hint) stream.write(`  ${c(hint, palette.faint)}\n`)
    },
    spinner(message) {
      let text = message
      // Progress belongs on stderr, and only when someone is watching: piping
      // ankou into a file should not fill it with spinner frames.
      if (quiet || !stream.isTTY) {
        write(`${c('·', palette.accent)} ${message}`)
        return { update: () => {}, stop: () => {} }
      }
      let frame = 0
      const draw = () => {
        stream.write(`${CLEAR_LINE}${c(FRAMES[frame % FRAMES.length]!, palette.accent)} ${text}`)
        frame += 1
      }
      draw()
      const timer = setInterval(draw, 90)
      timer.unref()
      return {
        update(next) {
          text = next
        },
        stop() {
          clearInterval(timer)
          stream.write(CLEAR_LINE)
        },
      }
    },
  }
}

export const style = { ansi, palette }
