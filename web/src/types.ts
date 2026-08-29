export type PracticeMode = 'practice' | 'timed'

export interface ExamSummary {
  slug: string
  code: string
  title: string
  sourceFile: string
  deckVersion: string
  updatedOn: string
  questionCount: number
  domains: string[]
  topics: string[]
}

export interface DeckManifest {
  generatedAt: string
  exams: ExamSummary[]
}

export interface ExamCatalogEntry {
  code: string
  title: string
  sourceUrl: string
  sourcePageUrl: string
  retrievedAt: string
}

export interface ExamCatalog {
  schemaVersion: 1
  exams: ExamCatalogEntry[]
}

export interface SupportedExamCodes {
  schemaVersion: 1
  codes: string[]
}

export interface QuestionOption {
  key: 'A' | 'B' | 'C'
  label: string
}

export interface QuestionRecord {
  id: string
  examSlug: string
  domain: string
  topic: string
  tags: string[]
  promptHtml: string
  options: QuestionOption[]
  correctOption: 'A' | 'B' | 'C'
  correctLabel: string
  rationaleHtml: string
  extraHtml: string
}

export interface ExamDeck {
  exam: ExamSummary
  questions: QuestionRecord[]
}

export interface ExamProgress {
  deckVersion?: string
  lastCompletedAt?: string
  lastMode?: PracticeMode
  lastScore?: number
  lastTotal?: number
  missedIds: string[]
}

export type ProgressMap = Record<string, ExamProgress>