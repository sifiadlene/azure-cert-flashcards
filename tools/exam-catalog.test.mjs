import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  CURRENT_CATALOG_SIZE,
  buildSupportedExamCodes,
  computeRequestableExams,
  parseAvailabilityCatalog,
  serializeJson,
  validateCatalog,
} from './exam-catalog.mjs'

const toolsDirectory = path.dirname(fileURLToPath(import.meta.url))
const fixturePath = path.join(toolsDirectory, 'fixtures', 'microsoft-learn-practice-assessments.html')
const retrievedAt = '2026-08-29T00:00:00.000Z'

async function fixtureHtml() {
  return readFile(fixturePath, 'utf8')
}

describe('Microsoft Learn Availability parser', () => {
  it('parses all 49 entries, ignores duplicated S/N values, and sorts by normalized code', async () => {
    const exams = parseAvailabilityCatalog(await fixtureHtml(), retrievedAt)

    assert.equal(exams.length, CURRENT_CATALOG_SIZE)
    assert.equal(new Set(exams.map(({ code }) => code)).size, CURRENT_CATALOG_SIZE)
    assert.deepEqual(exams.map(({ code }) => code), [...exams.map(({ code }) => code)].sort())
    assert.deepEqual(exams[0], {
      code: 'AB-100',
      title: 'Agentic AI Business Solutions Architect',
      sourceUrl: 'https://learn.microsoft.com/en-us/credentials/certifications/exams/ab-100/practice/assessment?assessment-type=practice&assessmentId=1815645847&practice-assessment-type=certification',
      sourcePageUrl: 'https://learn.microsoft.com/en-us/credentials/certifications/practice-assessments-for-microsoft-certifications',
      retrievedAt,
    })
    assert.deepEqual(exams.find(({ code }) => code === 'AI-901'), {
      code: 'AI-901',
      title: 'Microsoft Azure AI Fundamentals',
      sourceUrl: 'https://aiskillsnavigator.microsoft.com/credentials/cert-83587e0a0754cfee561ade3e27d9fa1cdaf15ae03be52d2413b2b858d1b4eda4',
      sourcePageUrl: 'https://learn.microsoft.com/en-us/credentials/certifications/practice-assessments-for-microsoft-certifications',
      retrievedAt,
    })
  })

  it('produces deterministic JSON for the same fixture and timestamp', async () => {
    const html = await fixtureHtml()
    const first = serializeJson({ schemaVersion: 1, exams: parseAvailabilityCatalog(html, retrievedAt) })
    const second = serializeJson({ schemaVersion: 1, exams: parseAvailabilityCatalog(html, retrievedAt) })

    assert.equal(first, second)
  })

  it('fails closed when the Availability heading or table shape changes', async () => {
    const html = await fixtureHtml()

    assert.throws(() => parseAvailabilityCatalog(html.replace('id="availability"', 'id="available"'), retrievedAt), /Availability heading/)
    assert.throws(() => parseAvailabilityCatalog(html.replace('<td>1</td>', '<td>1</td><td>unexpected</td>'), retrievedAt), /Expected two cells/)
  })

  it('rejects duplicate codes and unapproved links', async () => {
    const html = await fixtureHtml()
    const duplicate = html.replace('AB-730: AI Business Professional', 'AB-100: AI Business Professional')
    const unapproved = html.replace('/en-us/credentials/certifications/exams/ab-100/practice/assessment?assessment-type=practice&amp;assessmentId=1815645847&amp;practice-assessment-type=certification', 'https://example.com/practice')

    assert.throws(() => parseAvailabilityCatalog(duplicate, retrievedAt), /Duplicate exam code/)
    assert.throws(() => parseAvailabilityCatalog(unapproved, retrievedAt), /Unapproved practice assessment URL/)
  })

  it('rejects a catalog that unexpectedly shrinks', async () => {
    const exams = parseAvailabilityCatalog(await fixtureHtml(), retrievedAt)

    assert.throws(() => validateCatalog({ schemaVersion: 1, exams: exams.slice(1) }), /unexpectedly shrank/)
  })
})

describe('supported and requestable exam derivation', () => {
  it('derives one sorted supported set and computes the catalog difference', async () => {
    const catalog = { schemaVersion: 1, exams: parseAvailabilityCatalog(await fixtureHtml(), retrievedAt) }
    const supported = buildSupportedExamCodes({ exams: [
      { code: 'GH-900' }, { code: 'AI-102' }, { code: 'AZ-204' }, { code: 'AB-100' },
      { code: 'AI-103' }, { code: 'AI-300' }, { code: 'AI-900' }, { code: 'AZ-104' },
      { code: 'AZ-305' }, { code: 'AZ-400' }, { code: 'AZ-500' }, { code: 'AZ-700' },
      { code: 'AZ-900' }, { code: 'GH-300' },
    ] })
    const requestable = computeRequestableExams(catalog, supported)

    assert.equal(supported.codes.length, 14)
    assert.deepEqual(supported.codes, [...supported.codes].sort())
    assert.equal(requestable.length, 37)
    assert.equal(requestable.some(({ code }) => code === 'AB-100'), false)
    assert.equal(requestable.some(({ code }) => code === 'AI-901'), true)
    assert.equal(requestable.some(({ code }) => code === 'AI-102'), false)
    assert.equal(requestable.some(({ code }) => code === 'AZ-204'), false)
  })
})
