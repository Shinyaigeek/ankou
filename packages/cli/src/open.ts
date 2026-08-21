import { spawn } from 'node:child_process'

/** Open a file with the platform's default handler, detached and silent. */
export function openInBrowser(target: string): void {
  const command =
    process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open'
  const args = process.platform === 'win32' ? ['', target] : [target]
  try {
    const child = spawn(command, args, {
      detached: true,
      stdio: 'ignore',
      shell: process.platform === 'win32',
    })
    child.unref()
  } catch {
    // Opening is a convenience; the path is already printed either way.
  }
}
