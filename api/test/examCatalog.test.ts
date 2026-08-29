import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { loadExamCatalog } from '../src/application/examCatalog'

describe('API runtime exam catalog', () => {
  it('loads canonical artifacts and authoritatively identifies supported exams', async () => {
    const catalog = await loadExamCatalog(resolve(process.cwd(), '..', 'catalog'))

    expect(catalog.isSupported('AB-100')).toBe(true)
    expect(catalog.isSupported('AI-901')).toBe(false)
    expect(catalog.isSupported('ab-100')).toBe(false)
    expect(catalog.find('AI-901')).toMatchObject({
      code: 'AI-901',
      title: 'Microsoft Azure AI Fundamentals',
    })
    expect(catalog.requestableExams()).toHaveLength(37)
  })
})