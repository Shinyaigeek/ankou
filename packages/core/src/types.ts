/**
 * Core domain types for ankou.
 *
 * The pipeline is: Source -> Document -> Plan -> Piece -> rendered output.
 *
 *  - `Document` is what we ingested, normalised but never rewritten.
 *  - `Plan` is the decision of *what shape* the reader wants.
 *  - `Piece` is the format-specific intermediate representation. Renderers only
 *    ever see a `Piece`, never the LLM, so a new renderer is a pure function.
 */

// --- sources ---------------------------------------------------------------

export type SourceKind = 'markdown' | 'text' | 'html' | 'pdf' | 'url'

/**
 * A source can be given as a bare string (a path, a URL, or inline content) or
 * as an explicit descriptor when auto-detection would guess wrong.
 */
export type Source =
  | string
  | {
      kind?: SourceKind
      /** Local file path. */
      path?: string
      /** Remote URL; fetched with `fetch`. */
      url?: string
      /** Inline content, already in memory. */
      content?: string
      /** Display name; defaults to the basename / hostname. */
      name?: string
      /** Force the character encoding, when the source does not declare one. */
      encoding?: string
    }

export interface Section {
  level: number
  title: string
  text: string
}

export interface Document {
  id: string
  title: string
  origin: { kind: SourceKind; ref: string }
  /** Normalised plain text / light markdown. Verbatim: never LLM-rewritten. */
  text: string
  sections: Section[]
  meta: Record<string, unknown>
  charCount: number
  /** Best-effort BCP-47-ish tag, e.g. `ja`, `en`. */
  lang: string
}

// --- planning --------------------------------------------------------------

export type FormatId = 'flipbook' | 'slides' | 'quiz' | 'animation' | 'summary' | 'dialogue'

export interface Plan {
  format: FormatId
  /** Why this format was chosen, in the reader's own language. */
  rationale: string
  /** Format-specific knobs the planner wants to set (density, count, tone...). */
  params: Record<string, unknown>
}

// --- pieces (the intermediate representation) -------------------------------

export interface PieceBase {
  format: FormatId
  title: string
  /** Language of the generated content. */
  lang: string
  meta: {
    sources: { title: string; ref: string; kind: SourceKind }[]
    intent: string
    rationale: string
    generatedBy: string
    charCount: number
  }
}

export interface FlipbookChapter {
  title: string
  /** Verbatim slice of the source text. ankou never paraphrases here. */
  text: string
}

export interface FlipbookPiece extends PieceBase {
  format: 'flipbook'
  chapters: FlipbookChapter[]
  /** Terms the renderer should highlight as they fly past. */
  emphasis: { term: string; gloss?: string; weight: 1 | 2 | 3 }[]
  /** Readings for hard words, rendered as ruby above the running text. */
  ruby: { term: string; reading: string }[]
  pacing: { baseMs: number; punctuationMs: number; paragraphMs: number }
}

export interface Slide {
  title: string
  bullets: string[]
  notes?: string
  /** Optional focal element for the slide body. */
  visual?:
    | { type: 'quote'; text: string; attribution?: string }
    | { type: 'stat'; value: string; caption: string }
    | { type: 'mermaid'; code: string }
    | { type: 'code'; language: string; code: string }
}

export interface SlidesPiece extends PieceBase {
  format: 'slides'
  slides: Slide[]
}

export interface Question {
  id: string
  kind: 'single' | 'multi' | 'short'
  prompt: string
  choices?: { id: string; text: string }[]
  /** Choice ids for single/multi; accepted strings for short answers. */
  answer: string[]
  explanation: string
  /** Verbatim quote from the source that justifies the answer. */
  evidence?: string
  difficulty: 1 | 2 | 3
}

export interface QuizPiece extends PieceBase {
  format: 'quiz'
  questions: Question[]
  passScore: number
}

export interface Scene {
  id: string
  lines: { text: string; scale?: 'sm' | 'md' | 'lg' | 'xl'; accent?: boolean }[]
  motion: 'fade' | 'slide-up' | 'zoom' | 'typewriter' | 'stagger' | 'flip'
  durationMs: number
  holdMs: number
  mood: 'calm' | 'tense' | 'bright' | 'dark'
}

export interface AnimationPiece extends PieceBase {
  format: 'animation'
  scenes: Scene[]
}

export interface SummaryPiece extends PieceBase {
  format: 'summary'
  tldr: string
  keyPoints: { text: string; detail?: string }[]
  outline: { title: string; summary: string; points: string[] }[]
  glossary: { term: string; definition: string }[]
  openQuestions: string[]
}

export interface DialoguePiece extends PieceBase {
  format: 'dialogue'
  speakers: { id: string; name: string; role: string }[]
  turns: { speaker: string; text: string }[]
}

export type Piece =
  | FlipbookPiece
  | SlidesPiece
  | QuizPiece
  | AnimationPiece
  | SummaryPiece
  | DialoguePiece

export type PieceOf<F extends FormatId> = Extract<Piece, { format: F }>

// --- rendering -------------------------------------------------------------

export type RendererId = 'html' | 'tui' | 'json'

export interface RenderOptions {
  theme?: 'dark' | 'light' | 'auto'
  /** Renderer-specific extras. */
  [key: string]: unknown
}

export interface RenderResult {
  renderer: RendererId
  /** File extension to use when writing to disk, without the dot. */
  ext: string
  mime: string
  content: string
}

// --- progress --------------------------------------------------------------

export type Stage = 'ingest' | 'plan' | 'compose' | 'render'

export interface ProgressEvent {
  stage: Stage
  message: string
  /** 0..1 within the stage when known. */
  progress?: number
}

export type OnProgress = (event: ProgressEvent) => void
