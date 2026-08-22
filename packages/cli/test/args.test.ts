import assert from 'node:assert/strict'
import { test } from 'node:test'
import { flagBool, flagString, nearestFlag, parseArgs } from '../dist/args.js'

test('an unknown flag is reported rather than obeyed', () => {
  // The quiet failures this exists to stop: `--plan-onlyy` ran the generation
  // the reader was trying to avoid, and `--forma quiz` made `quiz` a source.
  const typo = parseArgs(['spec.md', '--plan-onlyy'])
  assert.deepEqual(typo.unknown, ['--plan-onlyy'])
  assert.equal(flagBool(typo, 'plan-only'), undefined)

  const valued = parseArgs(['spec.md', '--forma', 'quiz'])
  assert.deepEqual(valued.unknown, ['--forma'])
  assert.deepEqual(valued.positionals, ['spec.md', 'quiz'])

  assert.deepEqual(parseArgs(['spec.md', '-z']).unknown, ['-z'])
  assert.deepEqual(parseArgs(['spec.md', '-i', 'x']).unknown, [])
})

test('nearestFlag suggests the flag a typo was reaching for', () => {
  assert.equal(nearestFlag('forma'), 'format')
  assert.equal(nearestFlag('plan-onlyy'), 'plan-only')
  assert.equal(nearestFlag('encodin'), 'encoding')
  assert.equal(nearestFlag('wildlyunrelated'), undefined)
})

test('the flags kamu does define still parse', () => {
  const args = parseArgs([
    'spec.md',
    '-i',
    '一字一句',
    '--format=quiz',
    '--encoding',
    'shift_jis',
    '--no-open',
    '-q',
  ])
  assert.deepEqual(args.unknown, [])
  assert.deepEqual(args.positionals, ['spec.md'])
  assert.equal(flagString(args, 'intent'), '一字一句')
  assert.equal(flagString(args, 'format'), 'quiz')
  assert.equal(flagString(args, 'encoding'), 'shift_jis')
  assert.equal(flagBool(args, 'open'), false)
  assert.equal(flagBool(args, 'quiet'), true)
})
