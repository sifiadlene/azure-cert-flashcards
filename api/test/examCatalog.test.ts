import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ExamCatalog, loadExamCatalog } from '../src/application/examCatalog'

const requestableExam = {
  code: 'ZZ-998',
  title: 'Requestable exam',
  sourceUrl: 'https://learn.microsoft.com/requestable',
  sourcePageUrl: 'https://learn.microsoft.com/catalog',
  retrievedAt: '2026-08-29T00:00:00.000Z',
}

describe('API runtime exam catalog', () => {
  it('uses the supported set and excludes missing or supported exams from requests', () => {
    const supportedExam = { ...requestableExam, code: 'ZZ-999', title: 'Supported exam' }
    const catalog = new ExamCatalog(
      { schemaVersion: 1, exams: [requestableExam, supportedExam] },
      { schemaVersion: 1, codes: [supportedExam.code] },
    )

    expect(catalog.isSupported(supportedExam.code)).toBe(true)
    expect(catalog.isSupported(requestableExam.code)).toBe(false)
    expect(catalog.isSupported('zz-999')).toBe(false)
    expect(catalog.find(requestableExam.code)).toEqual(requestableExam)
    expect(catalog.find('ZZ-997')).toBeUndefined()
    expect(catalog.requestableExams()).toEqual([requestableExam])
  })

  it('loads the canonical catalog and matches the tracked browser copy', async () => {
    const repository = resolve(process.cwd(), '..')
    const canonicalDirectory = resolve(repository, 'catalog')
    const fileName = 'microsoft-learn-practice-assessments.json'
    const [canonical, browser] = await Promise.all([
      readFile(resolve(canonicalDirectory, fileName), 'utf8'),
      readFile(resolve(repository, 'web', 'public', 'data', fileName), 'utf8'),
    ])
    const catalog = await loadExamCatalog(canonicalDirectory)
    const first = (JSON.parse(canonical) as { exams: typeof requestableExam[] }).exams[0]

    expect(browser).toBe(canonical)
    expect(catalog.find(first.code)).toEqual(first)
    expect(catalog.requestableExams().every(({ code }) => !catalog.isSupported(code))).toBe(true)
  })
})