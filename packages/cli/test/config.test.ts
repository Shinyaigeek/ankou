import assert from 'node:assert/strict'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { loadConfig } from '../dist/config.js'

/** Point ankou's config path at a fresh directory and put `contents` there. */
async function withConfig<T>(contents: string | null, run: () => Promise<T>): Promise<T> {
  const home = await mkdtemp(join(tmpdir(), 'ankou-config-'))
  const saved = process.env.XDG_CONFIG_HOME
  process.env.XDG_CONFIG_HOME = home
  try {
    if (contents !== null) {
      const { mkdir } = await import('node:fs/promises')
      await mkdir(join(home, 'ankou'), { recursive: true })
      await writeFile(join(home, 'ankou', 'config.json'), contents)
    }
    return await run()
  } finally {
    if (saved === undefined) delete process.env.XDG_CONFIG_HOME
    else process.env.XDG_CONFIG_HOME = saved
  }
}

test('no config file is silence, by design', async () => {
  const { config, problems } = await withConfig(null, loadConfig)
  assert.deepEqual(config, {})
  assert.deepEqual(problems, [])
})

test('a config that parses is read without comment', async () => {
  const { config, problems } = await withConfig('{"provider":"ollama","model":"x"}', loadConfig)
  assert.equal(config.provider, 'ollama')
  assert.equal(config.model, 'x')
  assert.deepEqual(problems, [])
})

test('a config that does not parse says so instead of vanishing', async () => {
  // It used to be the same silence as no file at all, and the run then failed
  // somewhere else complaining about the environment.
  const { config, problems } = await withConfig('{"provider":"ollama",}', loadConfig)
  assert.deepEqual(config, {})
  assert.equal(problems.length, 1)
  assert.match(problems[0]!, /not valid JSON/)
})

test('a misspelled setting is reported, with the one it probably meant', async () => {
  const { config, problems } = await withConfig(
    '{"povider":"ollama","modl":"x","provider":"anthropic","totallyUnknown":1}',
    loadConfig,
  )
  // The settings that are real still apply; only the strays are called out.
  assert.equal(config.provider, 'anthropic')
  assert.equal(problems.length, 3)
  assert.match(problems[0]!, /`povider`.*did you mean `provider`/)
  assert.match(problems[1]!, /`modl`.*did you mean `model`/)
  assert.match(problems[2]!, /`totallyUnknown`\.$/)
})

test('a config that is not an object is reported too', async () => {
  for (const contents of ['[1,2,3]', '"ollama"', 'null']) {
    const { config, problems } = await withConfig(contents, loadConfig)
    assert.deepEqual(config, {})
    assert.equal(problems.length, 1, contents)
  }
})
