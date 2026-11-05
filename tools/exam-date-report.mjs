import { readdir } from 'node:fs/promises'
import path from 'node:path'
import { selectLatestDecks, toDisplayCode } from './deck-files.mjs'
import { normalizeExamCode, readJson } from './exam-catalog.mjs'

const guideBase = 'https://learn.microsoft.com/en-us/credentials/certifications/resources/study-guides/'
const months = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

function requireDate(value, label) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)
    || !Number.isFinite(Date.parse(value))
    || new Date(value).toISOString().slice(0, 10) !== value) {
    throw new Error(`Invalid ${label}: ${value}`)
  }
  return value
}

function requireTimestamp(value, label) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(value)
    || !Number.isFinite(Date.parse(value))) {
    throw new Error(`Invalid ${label}: ${value}`)
  }
  requireDate(value.slice(0, 10), label)
  return value
}

function textContent(html) {
  return html.replace(/<[^>]+>/g, ' ')
    .replace(/&#x([a-f0-9]+);/gi, (_match, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_match, decimal) => String.fromCodePoint(Number(decimal)))
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/\s+/g, ' ').trim()
}

function attributes(tag) {
  return Object.fromEntries([...tag.matchAll(/([\w.-]+)\s*=\s*["']([^"']*)["']/g)]
    .map((match) => [match[1].toLowerCase(), match[2]]))
}

export function studyGuideUrl(code) {
  if (normalizeExamCode(code) !== code) throw new Error(`Noncanonical exam code: ${code}`)
  return `${guideBase}${code.toLowerCase()}`
}

export async function readReportDecks(repositoryDirectory) {
  const decks = selectLatestDecks(await readdir(path.join(repositoryDirectory, 'flashcards')))
  const manifest = await readJson(path.join(repositoryDirectory, 'web/public/data/exams.json'))
  if (!decks.length || !Array.isArray(manifest.exams) || manifest.exams.length !== decks.length) {
    throw new Error('Deck manifest does not match local CSVs; run cd web && npm run build:data')
  }
  for (const deck of decks) {
    requireDate(deck.date, 'generation date')
    deck.code = toDisplayCode(deck.slug)
    studyGuideUrl(deck.code)
    const matches = manifest.exams.filter((exam) => exam.slug === deck.slug)
    if (matches.length !== 1 || matches[0].code !== deck.code
      || matches[0].sourceFile !== deck.filename || matches[0].updatedOn !== deck.date
      || matches[0].deckVersion !== deck.date) {
      throw new Error(`Deck manifest drift for ${deck.code}; run cd web && npm run build:data`)
    }
  }
  return decks
}

function parseObjectiveHeading(heading) {
  const match = heading.match(/^Skills (?:measured|at a glance) as of (\w+) (?:(\d{1,2}),? )?(\d{4})$/i)
  if (!match) throw new Error(`Unrecognized objective date heading: ${heading}`)
  const month = months.findIndex((value) => value.toLowerCase() === match[1].toLowerCase()) + 1
  if (!month) throw new Error(`Invalid objective month: ${heading}`)
  const date = `${match[3]}-${String(month).padStart(2, '0')}`
  if (!match[2]) return { date, precision: 'month', evidence: heading }
  return {
    date: requireDate(`${date}-${match[2].padStart(2, '0')}`, 'objective date'),
    precision: 'day',
    evidence: heading,
  }
}

export function parseStudyGuide(html, code) {
  const mains = [...html.matchAll(/<main\b[^>]*>([\s\S]*?)<\/main>/gi)]
  if (mains.length !== 1) throw new Error(`${code}: Expected one guide main element`)
  const main = mains[0][1]
  const titles = [...main.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/gi)]
    .map((match) => textContent(match[1]))
  const prefix = `Study guide for Exam ${code}: `
  if (!titles.length || titles.filter((title) => /^Study guide for Exam /i.test(title)).length !== 1
    || !titles[0].toLowerCase().startsWith(prefix.toLowerCase())
    || titles[0].length === prefix.length) {
    throw new Error(`${code}: Study guide title does not identify the expected exam`)
  }
  const updates = [...main.matchAll(/Last updated on\s*<local-time\b[^>]*>[\s\S]*?<\/local-time>/gi)]
  if (updates.length !== 1) throw new Error(`${code}: Expected one displayed Last updated date`)
  const pageUpdatedOn = requireDate(textContent(updates[0][0]).replace(/^Last updated on\s*/i, ''), 'guide update date')
  const pageUpdatedAt = requireTimestamp(attributes(updates[0][0]).datetime, 'displayed guide timestamp')
  if (!pageUpdatedAt.startsWith(pageUpdatedOn)) throw new Error(`${code}: Conflicting displayed guide dates`)

  const metadata = [...html.matchAll(/<meta\b[^>]*>/gi)].map((match) => attributes(match[0]))
    .filter((entry) => entry.name === 'updated_at')
  if (metadata.length !== 1) throw new Error(`${code}: Expected one updated_at metadata timestamp`)
  const metadataUpdatedAt = requireTimestamp(metadata[0].content, 'guide metadata timestamp')
  const headings = []
  let priorVersion = false
  for (const match of main.matchAll(/<h([23])\b[^>]*>([\s\S]*?)<\/h\1>/gi)) {
    const heading = textContent(match[2])
    if (match[1] === '2') priorVersion = /^Skills (?:measured|at a glance) prior to /i.test(heading)
    if (priorVersion && match[1] !== '2') continue
    if (/^Skills (?:measured|at a glance)\b/i.test(heading)) headings.push(heading)
  }
  if (!headings.length) throw new Error(`${code}: Missing skills headings; guide layout may have changed`)
  const objectives = []
  for (const heading of headings) {
    if (/^Skills (?:measured|at a glance)(?: prior to .+)?$/i.test(heading)) continue
    const objective = parseObjectiveHeading(heading)
    if (!objectives.some((entry) => entry.date === objective.date)) objectives.push(objective)
  }
  objectives.sort((left, right) => left.date.localeCompare(right.date))
  return {
    code,
    title: titles[0].slice(prefix.length),
    guideUrl: studyGuideUrl(code),
    pageUpdatedOn,
    pageUpdatedAt,
    metadataUpdatedAt,
    pageUpdateEvidence: textContent(updates[0][0]),
    objectives,
    objectiveEvidence: headings,
  }
}

export function validateGuideSnapshot(snapshot, decks) {
  if (snapshot?.schemaVersion !== 1 || !Array.isArray(snapshot.exams)) {
    throw new Error('Study guide snapshot must use schemaVersion 1 and contain exams')
  }
  requireTimestamp(snapshot.retrievedAt, 'retrieval timestamp')
  if (snapshot.exams.length !== decks.length) throw new Error('Study guide snapshot exam count differs from local decks')
  for (const [index, deck] of decks.entries()) {
    const exam = snapshot.exams[index]
    if (exam.code !== deck.code || exam.guideUrl !== studyGuideUrl(deck.code)) {
      throw new Error(`Study guide snapshot codes must match sorted decks: ${deck.code}`)
    }
    if (typeof exam.title !== 'string' || !exam.title.trim()) throw new Error(`${exam.code}: Missing guide title`)
    requireDate(exam.pageUpdatedOn, 'guide update date')
    requireTimestamp(exam.pageUpdatedAt, 'displayed guide timestamp')
    requireTimestamp(exam.metadataUpdatedAt, 'guide metadata timestamp')
    if (!exam.pageUpdatedAt.startsWith(exam.pageUpdatedOn)
      || exam.pageUpdateEvidence !== `Last updated on ${exam.pageUpdatedOn}`) {
      throw new Error(`${exam.code}: Guide update evidence does not match dates`)
    }
    if (!Array.isArray(exam.objectiveEvidence) || !exam.objectiveEvidence.length
      || exam.objectiveEvidence.some((heading) => typeof heading !== 'string'
        || !/^Skills (?:measured|at a glance)(?: as of .+| prior to .+)?$/i.test(heading))
      || !Array.isArray(exam.objectives)) {
      throw new Error(`${exam.code}: Missing or invalid objective evidence`)
    }
    const expected = new Map()
    for (const heading of exam.objectiveEvidence.filter((value) => / as of /i.test(value))) {
      const objective = parseObjectiveHeading(heading)
      if (!expected.has(objective.date)) expected.set(objective.date, objective)
    }
    const expectedObjectives = [...expected.values()].sort((left, right) => left.date.localeCompare(right.date))
    if (JSON.stringify(exam.objectives) !== JSON.stringify(expectedObjectives)) {
      throw new Error(`${exam.code}: Objective dates do not match source evidence`)
    }
  }
  return snapshot
}

export async function fetchGuideSnapshot(decks, {
  retrievedAt = new Date().toISOString(),
  fetchImpl = fetch,
} = {}) {
  requireTimestamp(retrievedAt, 'retrieval timestamp')
  const exams = []
  for (const deck of decks) {
    const url = studyGuideUrl(deck.code)
    const response = await fetchImpl(url, {
      headers: { accept: 'text/html', 'user-agent': 'certification-flashcards-study-guide-refresh/1.0' },
      signal: AbortSignal.timeout(30_000),
      redirect: 'error',
    })
    if (!response.ok) throw new Error(`${deck.code}: Study guide request failed with HTTP ${response.status}`)
    exams.push(parseStudyGuide(await response.text(), deck.code))
  }
  return validateGuideSnapshot({ schemaVersion: 1, retrievedAt, exams }, decks)
}

function markdownCell(value) {
  return value.replace(/[\\`*_[\]<>|]/g, (character) => `&#${character.codePointAt(0)};`)
    .replace(/[\r\n]+/g, ' ')
}

export function renderExamDateReport(decks, snapshot) {
  validateGuideSnapshot(snapshot, decks)
  const asOf = snapshot.retrievedAt.slice(0, 10)
  const rows = decks.map((deck, index) => {
    const exam = snapshot.exams[index]
    const notes = []
    const objectives = exam.objectives.map(({ date, precision }) => {
      const upcoming = date > (precision === 'month' ? asOf.slice(0, 7) : asOf)
      if (precision === 'month') notes.push('Exact objective day not stated')
      if (upcoming) notes.push('Upcoming objectives; current effective date may not be stated')
      return `${date}${upcoming ? ' (upcoming)' : ''}`
    })
    if (!objectives.length) notes.push('Objective-effective date not stated')
    return `| [${deck.code}](${exam.guideUrl}) - ${markdownCell(exam.title)} | [${deck.date}](flashcards/${encodeURIComponent(deck.filename)}) | ${exam.pageUpdatedOn} | ${objectives.join('; ') || 'Not stated'} | ${[...new Set(notes)].join('; ') || '-'} |`
  })
  return [
    '# Exam date report',
    '',
    `Official English study guides checked at **${snapshot.retrievedAt}**. Covers **${decks.length} exams** with local flashcard decks.`,
    '',
    '| Exam / official study guide | Latest generation date / source CSV | Guide last updated | Published objective-effective date(s) | Notes |',
    '| --- | --- | --- | --- | --- |',
    ...rows,
    '',
    '## Date definitions',
    '',
    '- **Latest generation date** is the date declared in the selected CSV filename, using the same latest-deck selection as the website. It is not an independently recorded generation timestamp, a file modification date, a translation date, or the JSON build time.',
    '- **Guide last updated** is the date displayed in Microsoft Learn\'s "Last updated on" element. The snapshot separately preserves its timestamp and `updated_at` metadata; these can differ. `ms.date` is not used as a substitute.',
    '- **Published objective-effective dates** come from "Skills measured as of" or "Skills at a glance as of" headings, not "prior to" sections. Multiple published dates are retained; they are not all current. Upcoming dates are relative to the snapshot retrieval date, not the day this file is read. Month-only dates preserve their precision; effectiveness within that month is uncertain. "Not stated" means no effective date was found in the recognized skills headings, not a request failure.',
    '- A newer guide-page update does **not** by itself prove a deck is outdated or aligned with the exam. No content-alignment assessment is made by this report.',
    '',
    '## Refresh',
    '',
    'The versioned [study-guide snapshot](catalog/study-guide-dates.json) preserves source evidence. Report generation is offline; refreshing the snapshot deliberately accesses Microsoft Learn.',
    '',
    '```bash',
    'node tools/refresh-study-guide-dates.mjs',
    'node tools/generate-exam-date-report.mjs',
    'node tools/generate-exam-date-report.mjs --check',
    '```',
    '',
    'See [tools documentation](tools/README.md#exam-date-report) for validation and offline refresh instructions.',
    '',
  ].join('\n')
}
