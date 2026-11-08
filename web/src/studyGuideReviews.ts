import { isCalendarDate, type StudyGuideDate } from './studyGuideDates'

export interface StudyGuideReview {
  code: string
  guideUrl: string
  guideUpdatedOn: string
  deckVersion: string
  reviewedOn: string
  status: 'aligned' | 'gaps'
}

export function getCurrentStudyGuideReview(
  reviews: Map<string, StudyGuideReview>,
  code: string,
  guide: StudyGuideDate | undefined,
  deckVersion: string,
): StudyGuideReview | undefined {
  const review = reviews.get(code)
  return guide && review
    && review.guideUrl === guide.guideUrl
    && review.guideUpdatedOn === guide.pageUpdatedOn
    && review.deckVersion === deckVersion
    ? review
    : undefined
}

const examCodePattern = /^[A-Z]{2}-\d{3}$/
const guideBase = 'https://learn.microsoft.com/en-us/credentials/certifications/resources/study-guides/'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function parseStudyGuideReviews(value: unknown): Map<string, StudyGuideReview> {
  if (!isRecord(value) || value.schemaVersion !== 1 || !Array.isArray(value.reviews)) {
    throw new Error('Invalid study-guide review snapshot')
  }

  const reviews = new Map<string, StudyGuideReview>()
  for (const review of value.reviews) {
    if (!isRecord(review) || typeof review.code !== 'string' || !examCodePattern.test(review.code)
      || review.guideUrl !== `${guideBase}${review.code.toLowerCase()}`
      || !isCalendarDate(review.guideUpdatedOn)
      || !isCalendarDate(review.deckVersion)
      || !isCalendarDate(review.reviewedOn)
      || (review.status !== 'aligned' && review.status !== 'gaps')
      || reviews.has(review.code)) {
      throw new Error('Invalid study-guide review snapshot entry')
    }

    reviews.set(review.code, {
      code: review.code,
      guideUrl: review.guideUrl,
      guideUpdatedOn: review.guideUpdatedOn,
      deckVersion: review.deckVersion,
      reviewedOn: review.reviewedOn,
      status: review.status,
    })
  }

  return reviews
}

export async function loadStudyGuideReviews(
  url = `${import.meta.env.BASE_URL}data/study-guide-reviews.json`,
  fetcher: typeof fetch = globalThis.fetch.bind(globalThis),
): Promise<Map<string, StudyGuideReview>> {
  const response = await fetcher(url, { cache: 'no-store' })
  if (!response.ok) throw new Error(`Unable to load study-guide reviews (${response.status})`)
  return parseStudyGuideReviews(await response.json() as unknown)
}
