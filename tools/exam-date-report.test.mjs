import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import { selectLatestDecks, toDisplayCode } from './deck-files.mjs'
import {
  fetchGuideSnapshot,
  parseStudyGuide,
  readReportDecks,
  renderExamDateReport,
  studyGuideUrl,
  validateGuideSnapshot,
} from './exam-date-report.mjs'

const toolsDirectory = path.dirname(fileURLToPath(import.meta.url))
const repositoryDirectory = path.resolve(toolsDirectory, '..')
const fixture = await readFile(path.join(toolsDirectory, 'fixtures/study-guide.html'), 'utf8')
const retrievedAt = '2026-11-05T19:24:06.472Z'
const decks = [{
  code: 'AZ-104', slug: 'az104', date: '2026-03-24', count: 0,
  filename: 'az104_flashcards_2026-03-24.csv',
}]
const snapshot = (html = fixture) => ({
  schemaVersion: 1, retrievedAt, exams: [parseStudyGuide(html, 'AZ-104')],
})
const objectiveHtml = (headings) => fixture
  .replace(/<h[23]\b[^>]*>[\s\S]*?<\/h[23]>/g, '')
  .replace('</h1>', `</h1>${headings.map((heading) => `<h2>${heading}</h2>`).join('')}`)

describe('shared latest-deck selection', () => {
  it('uses newest date, then count, then filename; ignores translations and coverage files', () => {
    const filenames = [
      'az104_flashcards_100_2026-03-24.csv',
      'az104_flashcards_20_2026-03-24.csv',
      'az104_flashcards_999_2026-02-06.csv',
      'ai900_flashcards_2026-03-24.csv',
      'ai900_flashcards_0_2026-03-24.csv',
      'ai900-fr.json', 'gh300_coverage_2026-08-28.json', 'notes.csv',
    ]
    const expected = [
      { slug: 'ai900', filename: 'ai900_flashcards_2026-03-24.csv', date: '2026-03-24', count: 0 },
      { slug: 'az104', filename: 'az104_flashcards_100_2026-03-24.csv', date: '2026-03-24', count: 100 },
    ]
    assert.deepEqual(selectLatestDecks(filenames), expected)
    assert.deepEqual(selectLatestDecks(filenames.toReversed()), expected)
    assert.equal(toDisplayCode('GH300'), 'GH-300')
    assert.equal(toDisplayCode('custom'), 'CUSTOM')
    assert.equal(selectLatestDecks(['AI102_flashcards_2026-03-24.csv'])[0].slug, 'ai102')
  })

  it('matches every selected CSV to the committed website manifest', async () => {
    const actual = await readReportDecks(repositoryDirectory)
    assert.ok(actual.length > 0)
    assert.equal(new Set(actual.map((deck) => deck.code)).size, actual.length)
  })
})

describe('official study-guide date parsing', () => {
  it('uses the displayed date instead of ms.date or updated_at and excludes prior sections', () => {
    const exam = parseStudyGuide(fixture, 'AZ-104')
    assert.equal(exam.title, 'Microsoft Azure Administrator')
    assert.equal(exam.pageUpdatedOn, '2026-10-30')
    assert.equal(exam.pageUpdatedAt, '2026-10-30T21:22:00.000Z')
    assert.equal(exam.metadataUpdatedAt, '2026-10-31T01:16:00Z')
    assert.equal(exam.pageUpdateEvidence, 'Last updated on 2026-10-30')
    assert.deepEqual(exam.objectives, [{
      date: '2023-10-26', precision: 'day', evidence: 'Skills measured as of October 26, 2023',
    }])
    assert.equal(exam.guideUrl, studyGuideUrl('AZ-104'))
    assert.deepEqual(parseStudyGuide(fixture.replaceAll('"', "'"), 'AZ-104'), exam)
  })

  it('retains future and month-only dates and deduplicates repeated headings', () => {
    const html = objectiveHtml([
      'Skills measured as of November 16, 2026',
      'Skills at a glance as of January 2026',
      'Skills measured as of January 2026',
      'Skills measured prior to November 16, 2026',
    ])
    assert.deepEqual(parseStudyGuide(html, 'AZ-104').objectives, [
      { date: '2026-01', precision: 'month', evidence: 'Skills at a glance as of January 2026' },
      { date: '2026-11-16', precision: 'day', evidence: 'Skills measured as of November 16, 2026' },
    ])
  })

  it('records undated recognized skills headings without inventing a date', () => {
    const exam = parseStudyGuide(objectiveHtml(['Skills measured', 'Skills at a glance']), 'AZ-104')
    assert.deepEqual(exam.objectives, [])
    assert.deepEqual(exam.objectiveEvidence, ['Skills measured', 'Skills at a glance'])
  })

  it('does not interpret dated subheadings inside a prior-version section as current objectives', () => {
    const html = fixture.replace('Skills measured prior to October 26, 2023</h2>',
      'Skills measured prior to October 26, 2023</h2><h3>Skills at a glance as of January 2023</h3>')
    const exam = parseStudyGuide(html, 'AZ-104')
    assert.deepEqual(exam.objectives.map((objective) => objective.date), ['2023-10-26'])
    assert.ok(!exam.objectiveEvidence.includes('Skills at a glance as of January 2023'))
    assert.doesNotThrow(() => validateGuideSnapshot({ schemaVersion: 1, retrievedAt, exams: [exam] }, decks))
  })

  it('accepts GH-900 content with additional h1s while requiring a unique guide identity', () => {
    const html = fixture.replaceAll('AZ-104', 'GH-900').replace('</h1>', '</h1><h1>Another content section</h1>')
    assert.equal(parseStudyGuide(html, 'GH-900').code, 'GH-900')
    assert.throws(() => parseStudyGuide(html.replace('</main>',
      '<h1>Study guide for Exam GH-900: Duplicate title</h1></main>'), 'GH-900'), /expected exam/)
  })

  it('fails explicitly on changed layouts, wrong identities, missing or conflicting dates', () => {
    for (const [html, pattern] of [
      [fixture.replace('Exam AZ-104:', 'Exam AZ-305:'), /expected exam/],
      [fixture.replace('<main id="main">', '<article>'), /main element/],
      [fixture.replace('Last updated on', 'Updated'), /displayed Last updated/],
      [fixture.replace('name="updated_at"', 'name="other"'), /updated_at/],
      [fixture.replace('2026-10-30\n', '2026-10-29\n'), /Conflicting displayed/],
      [fixture.replace('2026-10-30\n', '2026-02-30\n'), /Invalid guide update/],
      [fixture.replace('2026-10-31T01:16:00Z', 'invalid'), /metadata timestamp/],
      [objectiveHtml([]), /Missing skills headings/],
      [objectiveHtml(['Skills measured effective tomorrow']), /Unrecognized objective/],
      [objectiveHtml(['Skills measured as of February 30, 2026']), /Invalid objective date/],
      [objectiveHtml(['Skills measured as of Smarch 1, 2026']), /Invalid objective month/],
    ]) {
      assert.throws(() => parseStudyGuide(html, 'AZ-104'), pattern)
    }
    assert.throws(() => studyGuideUrl('az-104'), /Noncanonical/)
  })
})

describe('snapshot validation and refresh', () => {
  it('requires exact sorted deck coverage, evidence consistency, and valid dates', () => {
    assert.equal(validateGuideSnapshot(snapshot(), decks).exams.length, 1)
    const mutations = [
      (value) => { value.schemaVersion = 2 },
      (value) => { value.retrievedAt = '2026-02-30T00:00:00Z' },
      (value) => { value.exams = [] },
      (value) => { value.exams[0].code = 'AZ-305' },
      (value) => { value.exams[0].guideUrl = 'https://example.com' },
      (value) => { value.exams[0].pageUpdateEvidence = 'unrelated' },
      (value) => { value.exams[0].objectiveEvidence = [] },
      (value) => { value.exams[0].objectives = [] },
      (value) => { value.exams[0].objectives[0].date = '2026-01-01' },
      (value) => { value.exams[0].objectives[0].precision = 'month' },
    ]
    for (const mutate of mutations) {
      const value = snapshot()
      mutate(value)
      assert.throws(() => validateGuideSnapshot(value, decks))
    }
  })

  it('fetches only official guides with timeouts and rejects redirects, HTTP and network failures', async () => {
    const value = await fetchGuideSnapshot(decks, {
      retrievedAt,
      fetchImpl: async (url, options) => {
        assert.equal(url, studyGuideUrl('AZ-104'))
        assert.equal(options.redirect, 'error')
        assert.ok(options.signal instanceof AbortSignal)
        return { ok: true, text: async () => fixture }
      },
    })
    assert.deepEqual(value, snapshot())
    await assert.rejects(fetchGuideSnapshot(decks, {
      fetchImpl: async () => ({ ok: false, status: 404 }),
    }), /AZ-104.*HTTP 404/)
    await assert.rejects(fetchGuideSnapshot(decks, {
      fetchImpl: async () => { throw new Error('network unavailable') },
    }), /network unavailable/)
    await assert.rejects(fetchGuideSnapshot(decks, {
      fetchImpl: async () => ({ ok: true, text: async () => '<html>Unexpected login page</html>' }),
    }), /main element/)
  })
})

describe('Markdown report', () => {
  it('keeps the committed report reproducible with exactly one row for every local deck', async () => {
    const localDecks = await readReportDecks(repositoryDirectory)
    const localSnapshot = JSON.parse(await readFile(path.join(repositoryDirectory, 'catalog/study-guide-dates.json'), 'utf8'))
    const report = await readFile(path.join(repositoryDirectory, 'EXAM-DATE-REPORT.md'), 'utf8')
    assert.equal(report, renderExamDateReport(localDecks, localSnapshot))
    assert.equal(report.split('\n').filter((line) => line.startsWith('| [')).length, localDecks.length)
  })

  it('renders deterministic date meanings, source links, and one row per exam', () => {
    const report = renderExamDateReport(decks, snapshot())
    assert.equal(report, renderExamDateReport(decks, snapshot()))
    assert.ok(report.includes(`| [AZ-104](${studyGuideUrl('AZ-104')})`))
    assert.ok(report.includes('[2026-03-24](flashcards/az104_flashcards_2026-03-24.csv) | 2026-10-30 | 2023-10-26 |'))
    assert.ok(report.includes('not an independently recorded generation timestamp'))
    assert.ok(report.includes('does **not** by itself prove a deck is outdated'))
    assert.ok(report.endsWith('\n'))
  })

  it('labels future dates relative to retrieval, preserves precision, and explains missing dates', () => {
    const value = snapshot(objectiveHtml([
      'Skills measured as of November 16, 2026',
      'Skills at a glance as of January 2026',
    ]))
    const report = renderExamDateReport(decks, value)
    assert.ok(report.includes('2026-01; 2026-11-16 (upcoming)'))
    assert.ok(report.includes('Exact objective day not stated'))
    value.retrievedAt = '2026-11-16T00:00:00.000Z'
    assert.ok(!renderExamDateReport(decks, value).includes('2026-11-16 (upcoming)'))
    assert.ok(renderExamDateReport(decks, snapshot(objectiveHtml(['Skills measured']))).includes('| Not stated |'))
  })

  it('escapes Markdown syntax in remote titles', () => {
    const value = snapshot()
    value.exams[0].title = 'Title | [link](https://example.com) <img>'
    const row = renderExamDateReport(decks, value).split('\n').find((line) => line.startsWith('| [AZ-104]'))
    assert.equal(row.split('|').length, 7)
    assert.ok(!row.includes('<img>'))
    assert.ok(!row.includes('[link]'))
  })
})

describe('offline CLI integration', () => {
  it('preserves the existing data builder outputs after sharing deck selection', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'exam-deck-builder-'))
    try {
      await mkdir(path.join(directory, 'web/scripts'), { recursive: true })
      await mkdir(path.join(directory, 'tools'), { recursive: true })
      for (const name of ['flashcards', 'catalog', 'web/public/data']) {
        await cp(path.join(repositoryDirectory, name), path.join(directory, name), { recursive: true })
      }
      for (const name of ['deck-files.mjs', 'exam-catalog.mjs']) {
        await cp(path.join(toolsDirectory, name), path.join(directory, 'tools', name))
      }
      await cp(path.join(repositoryDirectory, 'web/scripts/buildFlashcardData.mjs'),
        path.join(directory, 'web/scripts/buildFlashcardData.mjs'))
      execFileSync(process.execPath, [path.join(directory, 'web/scripts/buildFlashcardData.mjs')], { stdio: 'pipe' })
      const readManifest = async (root) => JSON.parse(await readFile(path.join(root, 'web/public/data/exams.json'), 'utf8'))
      const original = await readManifest(repositoryDirectory)
      const generated = await readManifest(directory)
      generated.generatedAt = original.generatedAt
      assert.deepEqual(generated, original)
      for (const exam of original.exams) {
        for (const suffix of ['', '-fr']) {
          const name = `web/public/data/decks/${exam.slug}${suffix}.json`
          const expected = JSON.parse(await readFile(path.join(repositoryDirectory, name), 'utf8'))
          assert.deepEqual(JSON.parse(await readFile(path.join(directory, name), 'utf8')), expected)
        }
      }
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('refreshes reproducibly, preserves snapshots on failure, checks drift, and rejects manifest mismatch', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'exam-date-report-'))
    try {
      for (const name of ['tools', 'catalog', 'flashcards', 'web/public/data', 'input']) {
        await mkdir(path.join(directory, name), { recursive: true })
      }
      for (const name of [
        'deck-files.mjs', 'exam-catalog.mjs', 'exam-date-report.mjs',
        'refresh-study-guide-dates.mjs', 'generate-exam-date-report.mjs',
      ]) {
        await cp(path.join(toolsDirectory, name), path.join(directory, 'tools', name))
      }
      const manifest = { exams: [{
        code: 'AZ-104', slug: 'az104', sourceFile: decks[0].filename,
        updatedOn: decks[0].date, deckVersion: decks[0].date,
      }] }
      const manifestPath = path.join(directory, 'web/public/data/exams.json')
      await writeFile(manifestPath, JSON.stringify(manifest))
      await writeFile(path.join(directory, 'flashcards', decks[0].filename), '')
      await writeFile(path.join(directory, 'input/az-104.html'), fixture)
      const run = (script, args = []) => execFileSync(process.execPath, [
        path.join(directory, 'tools', script), ...args,
      ], { encoding: 'utf8', stdio: 'pipe' })
      const refreshArgs = ['--input', path.join(directory, 'input'), '--retrieved-at', retrievedAt]
      assert.match(run('refresh-study-guide-dates.mjs', refreshArgs), /1 exams/)
      const snapshotPath = path.join(directory, 'catalog/study-guide-dates.json')
      const original = await readFile(snapshotPath, 'utf8')
      run('refresh-study-guide-dates.mjs', refreshArgs)
      assert.equal(await readFile(snapshotPath, 'utf8'), original)
      assert.match(run('generate-exam-date-report.mjs'), /1 exams/)
      assert.match(run('generate-exam-date-report.mjs', ['--check']), /current/)
      await writeFile(path.join(directory, 'EXAM-DATE-REPORT.md'), 'stale')
      assert.throws(() => run('generate-exam-date-report.mjs', ['--check']), /report drift/)
      await writeFile(path.join(directory, 'input/az-104.html'), 'unexpected content')
      assert.throws(() => run('refresh-study-guide-dates.mjs', refreshArgs), /main element/)
      assert.equal(await readFile(snapshotPath, 'utf8'), original)
      assert.throws(() => run('refresh-study-guide-dates.mjs', ['--input', path.join(directory, 'input')]), /requires --retrieved-at/)
      assert.throws(() => run('generate-exam-date-report.mjs', ['--unknown']), /Usage:/)
      manifest.exams[0].updatedOn = '2026-01-01'
      await writeFile(manifestPath, JSON.stringify(manifest))
      await assert.rejects(readReportDecks(directory), /manifest drift/)
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
})
