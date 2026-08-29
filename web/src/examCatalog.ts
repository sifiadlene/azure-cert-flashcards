import type {
  ExamCatalog,
  ExamCatalogEntry,
  SupportedExamCodes,
} from './types'

const EXAM_CODE_PATTERN = /^[A-Z]{2}-\d{3}$/

function validateCatalog(value: unknown): ExamCatalog {
  if (!value || typeof value !== 'object') throw new Error('Exam catalog must be an object')
  const catalog = value as Partial<ExamCatalog>
  if (catalog.schemaVersion !== 1 || !Array.isArray(catalog.exams)) {
    throw new Error('Exam catalog has an unsupported schema')
  }
  const codes = new Set<string>()
  for (const exam of catalog.exams) {
    if (!EXAM_CODE_PATTERN.test(exam?.code) || codes.has(exam.code)) {
      throw new Error('Exam catalog contains malformed or duplicate codes')
    }
    if (!exam.title || !exam.sourceUrl || !exam.sourcePageUrl || !exam.retrievedAt) {
      throw new Error(`Exam catalog entry ${exam.code} is incomplete`)
    }
    codes.add(exam.code)
  }
  return catalog as ExamCatalog
}

function validateSupportedCodes(value: unknown): SupportedExamCodes {
  if (!value || typeof value !== 'object') throw new Error('Supported exam codes must be an object')
  const supported = value as Partial<SupportedExamCodes>
  if (supported.schemaVersion !== 1 || !Array.isArray(supported.codes)) {
    throw new Error('Supported exam codes have an unsupported schema')
  }
  if (supported.codes.some((code) => !EXAM_CODE_PATTERN.test(code))
    || new Set(supported.codes).size !== supported.codes.length) {
    throw new Error('Supported exam codes contain malformed or duplicate codes')
  }
  return supported as SupportedExamCodes
}

export function computeRequestableExams(
  catalog: ExamCatalog,
  supported: SupportedExamCodes,
): ExamCatalogEntry[] {
  const supportedCodes = new Set(supported.codes)
  return catalog.exams.filter((exam) => !supportedCodes.has(exam.code))
}

export interface LoadedExamCatalog {
  catalog: ExamCatalog
  supported: SupportedExamCodes
  requestableExams: ExamCatalogEntry[]
}

export async function loadExamCatalog(
  dataBaseUrl = `${import.meta.env.BASE_URL}data`,
  fetcher: typeof fetch = globalThis.fetch.bind(globalThis),
): Promise<LoadedExamCatalog> {
  const baseUrl = dataBaseUrl.replace(/\/$/, '')
  const [catalogResponse, supportedResponse] = await Promise.all([
    fetcher(`${baseUrl}/microsoft-learn-practice-assessments.json`, { cache: 'no-store' }),
    fetcher(`${baseUrl}/supported-exam-codes.json`, { cache: 'no-store' }),
  ])
  if (!catalogResponse.ok || !supportedResponse.ok) {
    throw new Error('Unable to load exam catalog data')
  }

  const [catalogValue, supportedValue] = await Promise.all([
    catalogResponse.json() as Promise<unknown>,
    supportedResponse.json() as Promise<unknown>,
  ])
  const catalog = validateCatalog(catalogValue)
  const supported = validateSupportedCodes(supportedValue)
  return { catalog, supported, requestableExams: computeRequestableExams(catalog, supported) }
}