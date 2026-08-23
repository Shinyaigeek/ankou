// Render every format to HTML with a stub model, so the gallery needs no key.
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { carve, FORMAT_IDS, render } from '../packages/core/dist/index.js'

const here = dirname(fileURLToPath(import.meta.url))
const outDir = join(here, 'out')

const SOURCE = `# The Bitter Lesson, in miniature

The biggest lesson that can be read from seventy years of AI research is that
general methods that leverage computation are ultimately the most effective, and
by a large margin.

## Why we keep relearning it

Researchers reach for human knowledge first because it helps in the short run and
is personally satisfying. The alternative — search and learning — feels like a
detour, right up until the moment it wins.

## What follows from it

We should build in only the meta-methods that can find and capture arbitrary
complexity. We want AI agents that can discover like we can, not which contain
what we have discovered.`

// A stub that answers each schema ankou asks for. A real provider is the same
// interface with a network call behind it.
const ANSWERS = {
  reading_plan: { format: 'summary', rationale: 'Example.', params: {} },
  flipbook_annotations: {
    title: 'The Bitter Lesson, in miniature',
    chapterTitles: ['The lesson', 'Why we keep relearning it', 'What follows from it'],
    emphasis: [
      { term: 'general methods that leverage computation', gloss: 'the whole claim', weight: 3 },
      { term: 'search and learning', gloss: 'the two that scale', weight: 2 },
      { term: 'meta-methods', weight: 2 },
    ],
    ruby: [],
    pacing: { baseMs: 48, note: 'Essayistic prose, comfortable pace.' },
  },
  slide_deck: {
    title: 'The Bitter Lesson',
    slides: [
      {
        title: 'Computation beats cleverness, given time',
        bullets: [
          'Seventy years of AI research point the same way',
          'General methods win by a large margin',
        ],
        notes: 'Open on the claim, not on the history.',
      },
      {
        title: 'We reach for human knowledge because it pays off early',
        bullets: ['Short-term gains are real', 'They are also a ceiling'],
        visual: {
          type: 'quote',
          text: 'It feels like a detour, right up until the moment it wins.',
          attribution: 'Section 2',
        },
      },
      {
        title: 'Build the meta-method, not the knowledge',
        bullets: ['Capture arbitrary complexity', 'Agents that discover, not agents that remember'],
        visual: { type: 'stat', value: '70yrs', caption: 'of evidence for the same conclusion' },
      },
    ],
  },
  quiz: {
    questions: [
      {
        kind: 'single',
        prompt: 'What does the essay say wins in the long run?',
        choices: [
          { id: 'a', text: 'Encoding human domain knowledge' },
          { id: 'b', text: 'General methods that leverage computation' },
          { id: 'c', text: 'Larger research teams' },
        ],
        answer: ['b'],
        explanation: 'The claim is about generality plus compute, not about hand-built knowledge.',
        evidence: 'general methods that leverage computation are ultimately the most effective',
        difficulty: 1,
      },
      {
        kind: 'multi',
        prompt: 'Which two approaches does the essay identify as the ones that scale?',
        choices: [
          { id: 'a', text: 'Search' },
          { id: 'b', text: 'Hand-tuned heuristics' },
          { id: 'c', text: 'Learning' },
          { id: 'd', text: 'Expert systems' },
        ],
        answer: ['a', 'c'],
        explanation: 'Search and learning are the two that keep absorbing more compute.',
        difficulty: 2,
      },
      {
        kind: 'short',
        prompt: 'In one word: what should we build in, according to the last section?',
        answer: ['meta-methods', 'meta methods'],
        explanation: 'Only the meta-methods that can find and capture arbitrary complexity.',
        difficulty: 3,
      },
    ],
  },
  animation: {
    title: 'The Bitter Lesson',
    scenes: [
      {
        lines: [{ text: 'Seventy years.', scale: 'lg' }],
        motion: 'fade',
        durationMs: 700,
        holdMs: 1400,
        mood: 'dark',
      },
      {
        lines: [{ text: 'One lesson.', scale: 'xl', accent: 'true' }],
        motion: 'zoom',
        durationMs: 600,
        holdMs: 1500,
        mood: 'tense',
      },
      {
        lines: [
          { text: 'General methods', scale: 'lg' },
          { text: 'that leverage computation', scale: 'md' },
          { text: 'win.', scale: 'xl', accent: 'true' },
        ],
        motion: 'stagger',
        durationMs: 700,
        holdMs: 2000,
        mood: 'bright',
      },
      {
        lines: [
          { text: 'It feels like a detour,', scale: 'md' },
          { text: 'right up until it wins.', scale: 'md', accent: 'true' },
        ],
        motion: 'typewriter',
        durationMs: 1600,
        holdMs: 2200,
        mood: 'calm',
      },
    ],
  },
  summary_part: {
    sectionTitle: 'The lesson and what follows',
    summary:
      'Seventy years of AI research keep pointing at the same conclusion: methods that scale with computation beat methods that encode what humans already know.',
    points: [
      'General methods win by a large margin',
      'Human knowledge helps early and caps you later',
      'Search and learning are the two that absorb more compute',
    ],
    terms: [
      {
        term: 'meta-method',
        definition: 'A method that finds structure rather than containing it.',
      },
    ],
  },
  summary: {
    title: 'The Bitter Lesson, in miniature',
    tldr: 'Methods that scale with computation beat methods that encode human knowledge. We keep relearning this because encoding knowledge pays off early and caps out late.',
    keyPoints: [
      {
        text: 'Computation-leveraging generality wins',
        detail: 'And by a large margin, across seventy years.',
      },
      {
        text: 'Search and learning are the scalable pair',
        detail: 'They keep absorbing more compute usefully.',
      },
      {
        text: 'Build meta-methods, not knowledge',
        detail: 'Agents that discover, not agents that remember.',
      },
    ],
    openQuestions: ['What does this imply for domains where compute is not the bottleneck?'],
  },
  dialogue: {
    title: 'Talking through the Bitter Lesson',
    speakers: [
      { id: 'guide', name: 'Guide', role: 'Has read the essay several times' },
      { id: 'learner', name: 'Learner', role: 'Suspicious of sweeping claims' },
    ],
    turns: [
      {
        speaker: 'learner',
        text: 'So the claim is that thinking hard about a problem is a waste of time?',
      },
      {
        speaker: 'guide',
        text: 'Not quite. It is that the thinking which survives is the thinking about how to search and how to learn, rather than about the domain itself.',
      },
      {
        speaker: 'learner',
        text: 'That sounds like a convenient story for people with a lot of GPUs.',
      },
      {
        speaker: 'guide',
        text: 'It is a fair objection. The essay is a claim about the long run, and it is silent on what to do when you cannot buy more compute.',
      },
    ],
  },
}

const stub = {
  name: 'stub:gallery',
  async complete() {
    return '{}'
  },
  async structured(request) {
    return ANSWERS[request.name] ?? {}
  },
}

await mkdir(outDir, { recursive: true })
for (const format of FORMAT_IDS) {
  const { piece } = await carve({
    sources: [{ content: SOURCE, name: 'bitter-lesson.md' }],
    intent: 'Show me what this format looks like.',
    format,
    llm: stub,
  })
  const file = join(outDir, `${format}.html`)
  await writeFile(file, render(piece, 'html').content, 'utf8')
  console.log(file)
}
