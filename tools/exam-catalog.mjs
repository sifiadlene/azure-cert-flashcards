import { readFile } from 'node:fs/promises'

export const SOURCE_PAGE_URL = 'https://learn.microsoft.com/en-us/credentials/certifications/practice-assessments-for-microsoft-certifications'
export const CURRENT_CATALOG_SIZE = 49

const CODE_PATTERN = /^([A-Z]{2})\s*-\s*(\d{3})$/
const APPROVED_HOSTS = new Set(['learn.microsoft.com', 'aiskillsnavigator.microsoft.com'])

function decodeHtml(value) {
  return value
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_match, codePoint) => String.fromCodePoint(Number(codePoint)))
    .replace(/\s+/g, ' ')
    .trim()
}

export function normalizeExamCode(value) {
  const match = value.trim().toUpperCase().match(CODE_PATTERN)
  if (!match) {
    throw new Error(`Malformed exam code: ${value}`)
  }

  return `${match[1]}-${match[2]}`
}

export function validateSourceUrl(value) {
  let url
  try {
    url = new URL(value, SOURCE_PAGE_URL)
  } catch {
    throw new Error(`Malformed practice assessment URL: ${value}`)
  }

  if (url.protocol !== 'https:' || !APPROVED_HOSTS.has(url.hostname)) {
    throw new Error(`Unapproved practice assessment URL: ${url.href}`)
  }

  if (url.hostname === 'learn.microsoft.com') {
    if (!/^\/en-us\/credentials\/certifications\/.+\/practice\/assessment$/.test(url.pathname)) {
      throw new Error(`Unapproved Microsoft Learn practice assessment path: ${url.pathname}`)
    }
    if (url.searchParams.get('assessment-type') !== 'practice') {
      throw new Error(`Microsoft Learn URL is not a practice assessment: ${url.href}`)
    }
  } else if (!/^\/credentials\/cert-[a-f0-9]+$/.test(url.pathname) || url.search) {
    throw new Error(`Unapproved AI Skills Navigator credential URL: ${url.href}`)
  }

  return url.href
}

function extractAvailabilityTable(html) {
  const headings = [...html.matchAll(/<h2\b[^>]*\bid=["']availability["'][^>]*>[\s\S]*?<\/h2>/gi)]
  if (headings.length !== 1) {
    throw new Error(`Expected exactly one Availability heading, found ${headings.length}`)
  }

  const heading = headings[0]
  const sectionStart = heading.index + heading[0].length
  const nextHeadingOffset = html.slice(sectionStart).search(/<h2\b/gi)
  if (nextHeadingOffset === -1) {
    throw new Error('Availability section has no following level-two heading')
  }

  const section = html.slice(sectionStart, sectionStart + nextHeadingOffset)
  const tables = [...section.matchAll(/<table\b[^>]*>[\s\S]*?<\/table>/gi)]
  if (tables.length !== 1) {
    throw new Error(`Expected exactly one table in the Availability section, found ${tables.length}`)
  }

  return tables[0][0]
}

export function parseAvailabilityCatalog(html, retrievedAt) {
  const timestamp = new Date(retrievedAt)
  if (Number.isNaN(timestamp.valueOf()) || timestamp.toISOString() !== retrievedAt) {
    throw new Error('retrievedAt must be an ISO-8601 UTC timestamp')
  }

  const table = extractAvailabilityTable(html)
  const rows = [...table.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)]
  const exams = []
  const seenCodes = new Set()

  for (const row of rows) {
    const cells = [...row[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)]
    if (cells.length === 0) {
      continue
    }
    if (cells.length !== 2) {
      throw new Error(`Expected two cells in Availability row, found ${cells.length}`)
    }

    const links = [...cells[1][1].matchAll(/<a\b[^>]*\bhref=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)]
    if (links.length !== 1) {
      throw new Error(`Expected one practice assessment link in Availability row, found ${links.length}`)
    }

    const label = decodeHtml(links[0][2])
    const separator = label.indexOf(':')
    if (separator < 1) {
      throw new Error(`Practice assessment label is missing a code/title separator: ${label}`)
    }

    const code = normalizeExamCode(label.slice(0, separator))
    const title = label.slice(separator + 1).trim()
    if (!title) {
      throw new Error(`Practice assessment title is empty for ${code}`)
    }
    if (seenCodes.has(code)) {
      throw new Error(`Duplicate exam code: ${code}`)
    }
    seenCodes.add(code)

    exams.push({
      code,
      title,
      sourceUrl: validateSourceUrl(decodeHtml(links[0][1])),
      sourcePageUrl: SOURCE_PAGE_URL,
      retrievedAt,
    })
  }

  return exams.sort((left, right) => left.code.localeCompare(right.code))
}

export function validateCatalog(catalog, minimumSize = CURRENT_CATALOG_SIZE) {
  if (catalog?.schemaVersion !== 1 || !Array.isArray(catalog.exams)) {
    throw new Error('Exam catalog must use schemaVersion 1 and contain an exams array')
  }
  if (catalog.exams.length < minimumSize) {
    throw new Error(`Catalog unexpectedly shrank to ${catalog.exams.length} entries; minimum is ${minimumSize}`)
  }

  const codes = new Set()
  let previousCode = ''
  for (const exam of catalog.exams) {
    const code = normalizeExamCode(exam.code)
    if (code !== exam.code || code.localeCompare(previousCode) <= 0) {
      throw new Error(`Catalog codes must be unique and sorted: ${code}`)
    }
    if (typeof exam.title !== 'string' || !exam.title.trim()) {
      throw new Error(`Catalog title is missing for ${code}`)
    }
    validateSourceUrl(exam.sourceUrl)
    if (exam.sourcePageUrl !== SOURCE_PAGE_URL) {
      throw new Error(`Unexpected source page URL for ${code}`)
    }
    const timestamp = new Date(exam.retrievedAt)
    if (Number.isNaN(timestamp.valueOf()) || timestamp.toISOString() !== exam.retrievedAt) {
      throw new Error(`Invalid retrieval timestamp for ${code}`)
    }
    if (codes.has(code)) {
      throw new Error(`Duplicate exam code: ${code}`)
    }
    codes.add(code)
    previousCode = code
  }

  return catalog
}

export function serializeJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`
}

export async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'))
}

export function buildSupportedExamCodes(manifest) {
  if (!Array.isArray(manifest?.exams)) {
    throw new Error('Deck manifest must contain an exams array')
  }

  const codes = manifest.exams.map((exam) => normalizeExamCode(exam.code)).sort()
  if (new Set(codes).size !== codes.length) {
    throw new Error('Deck manifest contains duplicate exam codes')
  }

  return { schemaVersion: 1, codes }
}

export function computeRequestableExams(catalog, supportedArtifact) {
  validateCatalog(catalog)
  if (supportedArtifact?.schemaVersion !== 1 || !Array.isArray(supportedArtifact.codes)) {
    throw new Error('Supported exam artifact must use schemaVersion 1 and contain a codes array')
  }

  const supported = new Set(supportedArtifact.codes.map(normalizeExamCode))
  return catalog.exams.filter((exam) => !supported.has(exam.code))
}
