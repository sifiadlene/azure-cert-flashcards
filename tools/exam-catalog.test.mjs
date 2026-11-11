import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  buildCatalogCandidate,
  buildSupportedExamCodes,
  computeRequestableExams,
  createReviewReport,
  describeCatalogChanges,
  parseAvailabilityCatalog,
  semanticCatalogSha256,
  serializeJson,
  validateCatalog,
  validateSourceUrl,
} from './exam-catalog.mjs'
import { loadHtml } from './refresh-exam-catalog.mjs'

const toolsDirectory = path.dirname(fileURLToPath(import.meta.url))
const fixturePath = path.join(toolsDirectory, 'fixtures', 'microsoft-learn-practice-assessments.html')
const refreshPath = path.join(toolsDirectory, 'refresh-exam-catalog.mjs')
const retrievedAt = '2026-08-29T00:00:00.000Z'
const checkedAt = '2026-11-11T09:17:00.000Z'
const baseSha = 'a'.repeat(40)
const historicalFixtureSize = 49

async function fixtureHtml() {
  return readFile(fixturePath, 'utf8')
}

describe('Microsoft Learn Availability parser', () => {
  it('parses all 49 entries, ignores duplicated S/N values, and sorts by normalized code', async () => {
    const exams = parseAvailabilityCatalog(await fixtureHtml(), retrievedAt)

    assert.equal(exams.length, historicalFixtureSize)
    assert.equal(new Set(exams.map(({ code }) => code)).size, historicalFixtureSize)
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
    assert.throws(() => parseAvailabilityCatalog(html.replace('<td>1</td><td>', '<td>1<td>'), retrievedAt), /Expected two cells/)
    assert.throws(() => parseAvailabilityCatalog(html.replace('</tr>', ''), retrievedAt), /Malformed Availability table rows/)
    assert.throws(() => parseAvailabilityCatalog(html.replace('</table>', ''), retrievedAt), /Expected exactly one table/)
  })

  it('rejects duplicate codes and unapproved links', async () => {
    const html = await fixtureHtml()
    const duplicate = html.replace('AB-730: AI Business Professional', 'AB-100: AI Business Professional')
    const unapproved = html.replace('/en-us/credentials/certifications/exams/ab-100/practice/assessment?assessment-type=practice&amp;assessmentId=1815645847&amp;practice-assessment-type=certification', 'https://example.com/practice')

    assert.throws(() => parseAvailabilityCatalog(duplicate, retrievedAt), /Duplicate exam code/)
    assert.throws(() => parseAvailabilityCatalog(unapproved, retrievedAt), /Unapproved practice assessment URL/)
  })

  it('accepts localized Navigator credential URLs only on the approved path and host', () => {
    const url = 'https://aiskillsnavigator.microsoft.com/credentials/cert-abc123'
    assert.equal(validateSourceUrl(url), url)
    assert.equal(validateSourceUrl(url.replace('/credentials/', '/en-us/credentials/')), url.replace('/credentials/', '/en-us/credentials/'))
    assert.throws(() => validateSourceUrl(url.replace('aiskillsnavigator.microsoft.com', 'example.com')), /Unapproved/)
    assert.throws(() => validateSourceUrl(url.replace('/credentials/', '/fr-fr/credentials/')), /Unapproved/)
    assert.throws(() => validateSourceUrl(`${url}?next=1`), /Unapproved/)
    assert.throws(() => validateSourceUrl(url.replace('https://', 'http://')), /Unapproved/)
    assert.throws(() => validateSourceUrl(url.replace('https://', 'https://user@')), /Unapproved/)
    assert.throws(() => validateSourceUrl(url.replace('.com/', '.com:444/')), /Unapproved/)
  })

  it('accepts a structurally valid smaller catalog but rejects an empty catalog', async () => {
    const exams = parseAvailabilityCatalog(await fixtureHtml(), retrievedAt)

    assert.equal(validateCatalog({ schemaVersion: 1, exams: exams.slice(1) }).exams.length, historicalFixtureSize - 1)
    assert.throws(() => validateCatalog({ schemaVersion: 1, exams: [] }), /at least one/)
  })
})

describe('semantic catalog refresh', () => {
  it('preserves individual timestamps and fingerprints across no-op checks', async () => {
    const html = await fixtureHtml()
    const previous = { schemaVersion: 1, exams: parseAvailabilityCatalog(html, retrievedAt) }
    previous.exams[1].retrievedAt = '2026-09-10T00:00:00.000Z'
    const parsed = { schemaVersion: 1, exams: parseAvailabilityCatalog(html, checkedAt) }
    const candidate = buildCatalogCandidate(previous, parsed)
    const bytes = serializeJson(candidate)
    const report = createReviewReport(previous, candidate, checkedAt, baseSha, bytes)

    assert.equal(bytes, serializeJson(previous))
    assert.deepEqual(describeCatalogChanges(previous, candidate), { added: [], removed: [], changed: [] })
    assert.equal(semanticCatalogSha256(previous), semanticCatalogSha256(parsed))
    assert.equal(report.checkedAt, checkedAt)
    assert.equal(report.baseSha, baseSha)
    assert.equal(report.candidateSha256, createHash('sha256').update(bytes).digest('hex'))
    assert.equal(report.semanticSha256, semanticCatalogSha256(candidate))
    assert.throws(
      () => createReviewReport(previous, candidate, checkedAt, baseSha, serializeJson(parsed)),
      /Candidate bytes do not match/,
    )
  })

  it('reports equal-count additions, removals and title or URL changes by code', async () => {
    const html = await fixtureHtml()
    const previous = { schemaVersion: 1, exams: parseAvailabilityCatalog(html, retrievedAt) }
    const parsed = { schemaVersion: 1, exams: parseAvailabilityCatalog(html, checkedAt) }
    parsed.exams.shift()
    parsed.exams[0].title = 'Updated AI Business Professional'
    parsed.exams[1].sourceUrl = 'https://aiskillsnavigator.microsoft.com/en-us/credentials/cert-123'
    parsed.exams.push({
      code: 'ZZ-999',
      title: 'New practice assessment',
      sourceUrl: 'https://aiskillsnavigator.microsoft.com/credentials/cert-456',
      sourcePageUrl: previous.exams[0].sourcePageUrl,
      retrievedAt: checkedAt,
    })
    const candidate = buildCatalogCandidate(previous, parsed)
    const changes = describeCatalogChanges(previous, candidate)
    const report = createReviewReport(previous, candidate, checkedAt, baseSha, serializeJson(candidate))

    assert.equal(candidate.exams.length, previous.exams.length)
    assert.deepEqual(changes.added.map(({ code }) => code), ['ZZ-999'])
    assert.deepEqual(changes.removed.map(({ code }) => code), ['AB-100'])
    assert.deepEqual(changes.changed.map(({ code }) => code), ['AB-730', 'AB-731'])
    assert.equal(changes.changed[0].before.title, previous.exams[1].title)
    assert.equal(changes.changed[0].after.title, 'Updated AI Business Professional')
    assert.equal(changes.changed[1].before.sourceUrl, previous.exams[2].sourceUrl)
    assert.equal(changes.changed[1].after.sourceUrl, parsed.exams[1].sourceUrl)
    assert.equal(candidate.exams.find(({ code }) => code === 'AB-900').retrievedAt, retrievedAt)
    assert.equal(candidate.exams.find(({ code }) => code === 'AB-730').retrievedAt, checkedAt)
    assert.deepEqual({ added: report.added, removed: report.removed, changed: report.changed }, changes)
  })

  it('keeps the baseline untouched for no-op, changed and failed offline checks', async (t) => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'exam-catalog-'))
    t.after(() => rm(directory, { recursive: true, force: true }))
    const html = await fixtureHtml()
    const previous = { schemaVersion: 1, exams: parseAvailabilityCatalog(html, retrievedAt) }
    previous.exams[1].retrievedAt = '2026-09-10T00:00:00.000Z'
    const baseline = path.join(directory, 'baseline.json')
    const baselineBytes = serializeJson(previous)
    await writeFile(baseline, baselineBytes)

    function run(input, suffix) {
      const candidate = path.join(directory, `candidate-${suffix}.json`)
      const report = path.join(directory, `report-${suffix}.json`)
      const result = spawnSync(process.execPath, [
        refreshPath, '--check', '--input', input, '--output', baseline, '--retrieved-at', checkedAt,
        '--candidate', candidate, '--report', report, '--base-sha', baseSha,
      ], { encoding: 'utf8' })
      return { result, candidate, report }
    }

    const unchanged = run(fixturePath, 'unchanged')
    assert.equal(unchanged.result.status, 0, unchanged.result.stderr)
    assert.equal(await readFile(unchanged.candidate, 'utf8'), baselineBytes)
    const unchangedReport = JSON.parse(await readFile(unchanged.report, 'utf8'))
    assert.equal(unchangedReport.baseSha, baseSha)
    assert.equal(new Date(unchangedReport.checkedAt).toISOString(), unchangedReport.checkedAt)

    const changedInput = path.join(directory, 'changed.html')
    await writeFile(changedInput, html.replace('AB-730: AI Business Professional', 'AB-730: Updated AI Business Professional'))
    const changed = run(changedInput, 'changed')
    assert.equal(changed.result.status, 2, changed.result.stderr)
    assert.match(changed.result.stdout, /changes require review/)
    const changedReport = JSON.parse(await readFile(changed.report, 'utf8'))
    assert.equal(changedReport.changed[0].code, 'AB-730')
    assert.equal(changedReport.candidateSha256, createHash('sha256').update(await readFile(changed.candidate)).digest('hex'))
    const direct = spawnSync(process.execPath, [
      refreshPath, '--input', changedInput, '--output', baseline, '--retrieved-at', checkedAt,
    ], { encoding: 'utf8' })
    assert.equal(direct.status, 2, direct.stderr)

    const newOutput = path.join(directory, 'offline-output.json')
    const offline = spawnSync(process.execPath, [
      refreshPath, '--input', fixturePath, '--output', newOutput, '--retrieved-at', retrievedAt,
    ], { encoding: 'utf8' })
    assert.equal(offline.status, 0, offline.stderr)
    assert.equal(JSON.parse(await readFile(newOutput, 'utf8')).exams.length, historicalFixtureSize)

    const malformedInput = path.join(directory, 'malformed.html')
    await writeFile(malformedInput, html.replace('id="availability"', 'id="other"'))
    for (const [input, suffix] of [[malformedInput, 'malformed'], [path.join(directory, 'missing.html'), 'missing']]) {
      const failed = run(input, suffix)
      assert.equal(failed.result.status, 1)
      await assert.rejects(readFile(failed.candidate), { code: 'ENOENT' })
      await assert.rejects(readFile(failed.report), { code: 'ENOENT' })
    }
    assert.equal(await readFile(baseline, 'utf8'), baselineBytes)
  })

  it('fails visibly on source errors and never follows redirects', async () => {
    await assert.rejects(loadHtml(undefined, async (_url, options) => {
      assert.equal(options.redirect, 'error')
      throw new Error('simulated network failure')
    }), /simulated network failure/)
    await assert.rejects(loadHtml(undefined, async () => ({ ok: false, status: 503 })), /HTTP 503/)
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
