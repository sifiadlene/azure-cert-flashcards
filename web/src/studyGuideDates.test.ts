import { describe, expect, it, vi } from 'vitest'
import { formatCalendarDate, isCalendarDate, loadStudyGuideDates, parseStudyGuideDates } from './studyGuideDates'
import { getCurrentStudyGuideReview, loadStudyGuideReviews, parseStudyGuideReviews } from './studyGuideReviews'

function snapshot() {
  return {
    schemaVersion: 1,
    retrievedAt: '2026-11-06T03:37:24.980Z',
    exams: [
      {
        code: 'GH-300',
        guideUrl: 'https://learn.microsoft.com/en-us/credentials/certifications/resources/study-guides/gh-300',
        pageUpdatedOn: '2026-07-09',
      },
      {
        code: 'AZ-104',
        guideUrl: 'https://learn.microsoft.com/en-us/credentials/certifications/resources/study-guides/az-104',
        pageUpdatedOn: '2026-10-30',
      },
    ],
  }
}

describe('study-guide date data', () => {
  it('matches dates by exam code and leaves missing entries unavailable', () => {
    const dates = parseStudyGuideDates(snapshot())
    expect(dates.get('AZ-104')?.pageUpdatedOn).toBe('2026-10-30')
    expect(dates.get('GH-300')?.pageUpdatedOn).toBe('2026-07-09')
    expect(dates.get('AI-900')).toBeUndefined()
  })

  it('rejects malformed schemas, dates, duplicate codes and noncanonical links', () => {
    const mutations = [
      (value: ReturnType<typeof snapshot>) => { value.schemaVersion = 2 },
      (value: ReturnType<typeof snapshot>) => { value.retrievedAt = '2026-02-30T00:00:00Z' },
      (value: ReturnType<typeof snapshot>) => { value.exams = [] },
      (value: ReturnType<typeof snapshot>) => { value.exams[0].code = 'gh-300' },
      (value: ReturnType<typeof snapshot>) => { value.exams[0].pageUpdatedOn = '2026-02-30' },
      (value: ReturnType<typeof snapshot>) => { value.exams[0].guideUrl = 'https://example.com' },
      (value: ReturnType<typeof snapshot>) => { value.exams.push(value.exams[0]) },
    ]
    for (const mutate of mutations) {
      const value = snapshot()
      mutate(value)
      expect(() => parseStudyGuideDates(value)).toThrow()
    }
    expect(() => parseStudyGuideDates(null)).toThrow()
  })

  it('loads the static snapshot without caching and surfaces failures', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(snapshot())))
    const dates = await loadStudyGuideDates('/site/data/study-guide-dates.json', fetcher)
    expect(fetcher).toHaveBeenCalledWith('/site/data/study-guide-dates.json', { cache: 'no-store' })
    expect(dates.get('GH-300')?.pageUpdatedOn).toBe('2026-07-09')

    await expect(loadStudyGuideDates('/dates', vi.fn<typeof fetch>()
      .mockResolvedValue(new Response('unavailable', { status: 503 })))).rejects.toThrow('503')
    await expect(loadStudyGuideDates('/dates', vi.fn<typeof fetch>()
      .mockRejectedValue(new Error('offline')))).rejects.toThrow('offline')
    await expect(loadStudyGuideDates('/dates', vi.fn<typeof fetch>()
      .mockResolvedValue(new Response('{')))).rejects.toThrow()
  })

  it('formats valid calendar days in the chosen language and rejects invalid dates', () => {
    expect(formatCalendarDate('2026-08-28', 'en')).toBe('Aug 28, 2026')
    expect(formatCalendarDate('2026-07-09', 'fr')).toMatch(/9.*juil.*2026/)
    expect(isCalendarDate('2026-02-29')).toBe(false)
    expect(() => formatCalendarDate('2026-02-29', 'en')).toThrow('Invalid calendar date')
  })
})

describe('study-guide review data', () => {
  const snapshot = {
    schemaVersion: 1,
    reviews: [{
      code: 'AI-103',
      guideUrl: 'https://learn.microsoft.com/en-us/credentials/certifications/resources/study-guides/ai-103',
      guideUpdatedOn: '2026-10-31',
      deckVersion: '2026-08-29',
      reviewedOn: '2026-11-08',
      status: 'gaps',
    }],
  }
  const guide = {
    code: 'AI-103',
    guideUrl: 'https://learn.microsoft.com/en-us/credentials/certifications/resources/study-guides/ai-103',
    pageUpdatedOn: '2026-10-31',
  }

  it('parses review records by exam code and permits no current reviews', () => {
    expect(parseStudyGuideReviews(snapshot).get('AI-103')).toMatchObject({
      guideUpdatedOn: '2026-10-31',
      deckVersion: '2026-08-29',
      reviewedOn: '2026-11-08',
      status: 'gaps',
    })
    expect(parseStudyGuideReviews({ schemaVersion: 1, reviews: [] }).size).toBe(0)
  })

  it('rejects invalid dates, guide links, statuses, and duplicate exams', () => {
    const mutations = [
      (value: typeof snapshot) => { value.reviews[0].guideUpdatedOn = '2026-02-30' },
      (value: typeof snapshot) => { value.reviews[0].deckVersion = 'not-a-date' },
      (value: typeof snapshot) => { value.reviews[0].reviewedOn = '2026-02-30' },
      (value: typeof snapshot) => { value.reviews[0].guideUrl = 'https://example.com' },
      (value: typeof snapshot) => { value.reviews[0].status = 'incomplete' },
      (value: typeof snapshot) => { value.reviews.push(value.reviews[0]) },
    ]
    for (const mutate of mutations) {
      const value = structuredClone(snapshot)
      mutate(value)
      expect(() => parseStudyGuideReviews(value)).toThrow()
    }
    expect(() => parseStudyGuideReviews(null)).toThrow()
  })

  it('only treats a review as current for its exact guide revision and deck version', () => {
    const reviews = parseStudyGuideReviews(snapshot)
    const review = reviews.get('AI-103')
    if (!review) throw new Error('Review fixture is missing')
    expect(getCurrentStudyGuideReview(reviews, 'AI-103', guide, '2026-08-29')).toBe(review)
    expect(getCurrentStudyGuideReview(reviews, 'AI-103', { ...guide, pageUpdatedOn: '2026-11-05' }, '2026-08-29')).toBeUndefined()
    expect(getCurrentStudyGuideReview(reviews, 'AI-103', guide, '2026-11-09')).toBeUndefined()
    expect(getCurrentStudyGuideReview(reviews, 'AI-103', undefined, '2026-08-29')).toBeUndefined()
  })

  it('loads the checked-in review snapshot and surfaces failures', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(snapshot)))
    const reviews = await loadStudyGuideReviews('/site/data/study-guide-reviews.json', fetcher)
    expect(fetcher).toHaveBeenCalledWith('/site/data/study-guide-reviews.json', { cache: 'no-store' })
    expect(reviews.has('AI-103')).toBe(true)

    await expect(loadStudyGuideReviews('/reviews', vi.fn<typeof fetch>()
      .mockResolvedValue(new Response('unavailable', { status: 503 })))).rejects.toThrow('503')
  })
})
