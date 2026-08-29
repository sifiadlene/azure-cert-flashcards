import { describe, expect, it, vi } from 'vitest'
import { computeRequestableExams, loadExamCatalog } from './examCatalog'
import type { ExamCatalog, SupportedExamCodes } from './types'

const catalog: ExamCatalog = {
  schemaVersion: 1,
  exams: [
    {
      code: 'AB-100',
      title: 'Supported exam',
      sourceUrl: 'https://learn.microsoft.com/supported',
      sourcePageUrl: 'https://learn.microsoft.com/catalog',
      retrievedAt: '2026-08-29T00:00:00.000Z',
    },
    {
      code: 'AI-901',
      title: 'Requestable exam',
      sourceUrl: 'https://aiskillsnavigator.microsoft.com/requestable',
      sourcePageUrl: 'https://learn.microsoft.com/catalog',
      retrievedAt: '2026-08-29T00:00:00.000Z',
    },
  ],
}
const supported: SupportedExamCodes = { schemaVersion: 1, codes: ['AB-100', 'AI-102'] }

describe('web runtime exam catalog', () => {
  it('computes requestable exams as catalog minus supported codes', () => {
    expect(computeRequestableExams(catalog, supported).map(({ code }) => code)).toEqual(['AI-901'])
  })

  it('loads both runtime artifacts without caching and returns requestable exams', async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify(catalog)))
      .mockResolvedValueOnce(new Response(JSON.stringify(supported)))

    const loaded = await loadExamCatalog('/site/data/', fetcher)

    expect(fetcher).toHaveBeenNthCalledWith(
      1,
      '/site/data/microsoft-learn-practice-assessments.json',
      { cache: 'no-store' },
    )
    expect(fetcher).toHaveBeenNthCalledWith(
      2,
      '/site/data/supported-exam-codes.json',
      { cache: 'no-store' },
    )
    expect(loaded.requestableExams.map(({ code }) => code)).toEqual(['AI-901'])
  })
})