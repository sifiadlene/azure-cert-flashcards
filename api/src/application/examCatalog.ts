import { readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

export interface ExamCatalogEntry {
  code: string
  title: string
  sourceUrl: string
  sourcePageUrl: string
  retrievedAt: string
}

interface ExamCatalogArtifact {
  schemaVersion: 1
  exams: ExamCatalogEntry[]
}

interface SupportedExamCodesArtifact {
  schemaVersion: 1
  codes: string[]
}

interface ExamCatalogPaths {
  catalogPath?: string
  supportedCodesPath?: string
}

const EXAM_CODE_PATTERN = /^[A-Z]{2}-\d{3}$/

function assertExamCode(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !EXAM_CODE_PATTERN.test(value)) {
    throw new Error('Exam catalog contains a malformed exam code.')
  }
}

function parseCatalog(value: unknown): ExamCatalogArtifact {
  if (!value || typeof value !== 'object') throw new Error('Exam catalog must be an object.')
  const artifact = value as Partial<ExamCatalogArtifact>
  if (artifact.schemaVersion !== 1 || !Array.isArray(artifact.exams)) {
    throw new Error('Exam catalog must use schemaVersion 1 and contain an exams array.')
  }

  const codes = new Set<string>()
  for (const exam of artifact.exams) {
    assertExamCode(exam?.code)
    if (codes.has(exam.code)) throw new Error(`Exam catalog contains duplicate code ${exam.code}.`)
    if (!exam.title || !exam.sourceUrl || !exam.sourcePageUrl || !exam.retrievedAt) {
      throw new Error(`Exam catalog entry ${exam.code} is incomplete.`)
    }
    codes.add(exam.code)
  }
  return artifact as ExamCatalogArtifact
}

function parseSupportedCodes(value: unknown): SupportedExamCodesArtifact {
  if (!value || typeof value !== 'object') throw new Error('Supported exam codes must be an object.')
  const artifact = value as Partial<SupportedExamCodesArtifact>
  if (artifact.schemaVersion !== 1 || !Array.isArray(artifact.codes)) {
    throw new Error('Supported exam codes must use schemaVersion 1 and contain a codes array.')
  }

  const codes = new Set<string>()
  for (const code of artifact.codes) {
    assertExamCode(code)
    if (codes.has(code)) throw new Error(`Supported exam codes contain duplicate code ${code}.`)
    codes.add(code)
  }
  return artifact as SupportedExamCodesArtifact
}

export class ExamCatalog {
  private readonly entriesByCode: ReadonlyMap<string, ExamCatalogEntry>
  private readonly supportedCodes: ReadonlySet<string>

  constructor(catalog: ExamCatalogArtifact, supported: SupportedExamCodesArtifact) {
    this.entriesByCode = new Map(catalog.exams.map((exam) => [exam.code, exam]))
    this.supportedCodes = new Set(supported.codes)
  }

  find(code: string): ExamCatalogEntry | undefined {
    return this.entriesByCode.get(code)
  }

  isSupported(code: string): boolean {
    return this.supportedCodes.has(code)
  }

  requestableExams(): ExamCatalogEntry[] {
    return [...this.entriesByCode.values()].filter((exam) => !this.isSupported(exam.code))
  }
}

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, 'utf8')) as unknown
}

export async function loadExamCatalog(
  dataDirectory = resolve(process.cwd(), 'data'),
  paths: ExamCatalogPaths = {},
): Promise<ExamCatalog> {
  const [catalog, supported] = await Promise.all([
    readJson(paths.catalogPath ?? join(dataDirectory, 'microsoft-learn-practice-assessments.json')),
    readJson(paths.supportedCodesPath ?? join(dataDirectory, 'supported-exam-codes.json')),
  ])
  return new ExamCatalog(parseCatalog(catalog), parseSupportedCodes(supported))
}