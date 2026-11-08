export interface StudyGuideDate {
  code: string
  guideUrl: string
  pageUpdatedOn: string
}

const examCodePattern = /^[A-Z]{2}-\d{3}$/
const guideBase = 'https://learn.microsoft.com/en-us/credentials/certifications/resources/study-guides/'

export function isCalendarDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T00:00:00.000Z`)
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
}

export function formatCalendarDate(value: string, language: string): string {
  if (!isCalendarDate(value)) throw new Error(`Invalid calendar date: ${value}`)
  return new Intl.DateTimeFormat(language, { dateStyle: 'medium', timeZone: 'UTC' })
    .format(new Date(`${value}T00:00:00.000Z`))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function parseStudyGuideDates(value: unknown): Map<string, StudyGuideDate> {
  if (!isRecord(value) || value.schemaVersion !== 1 || !Array.isArray(value.exams) || value.exams.length === 0
    || typeof value.retrievedAt !== 'string'
    || !/^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(value.retrievedAt)
    || !isCalendarDate(value.retrievedAt.slice(0, 10))
    || !Number.isFinite(Date.parse(value.retrievedAt))) {
    throw new Error('Invalid study-guide snapshot')
  }

  const dates = new Map<string, StudyGuideDate>()
  for (const exam of value.exams) {
    if (!isRecord(exam) || typeof exam.code !== 'string' || !examCodePattern.test(exam.code)
      || !isCalendarDate(exam.pageUpdatedOn)
      || exam.guideUrl !== `${guideBase}${exam.code.toLowerCase()}`
      || dates.has(exam.code)) {
      throw new Error('Invalid study-guide snapshot entry')
    }
    dates.set(exam.code, {
      code: exam.code,
      guideUrl: exam.guideUrl,
      pageUpdatedOn: exam.pageUpdatedOn,
    })
  }
  return dates
}

export async function loadStudyGuideDates(
  url = `${import.meta.env.BASE_URL}data/study-guide-dates.json`,
  fetcher: typeof fetch = globalThis.fetch.bind(globalThis),
): Promise<Map<string, StudyGuideDate>> {
  const response = await fetcher(url, { cache: 'no-store' })
  if (!response.ok) throw new Error(`Unable to load study-guide snapshot (${response.status})`)
  return parseStudyGuideDates(await response.json() as unknown)
}
