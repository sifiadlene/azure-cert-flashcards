import { createHash } from 'node:crypto'
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url))
const webDirectory = path.resolve(scriptDirectory, '..')
const repositoryDirectory = path.resolve(webDirectory, '..')
const flashcardsDirectory = path.join(repositoryDirectory, 'flashcards')
const outputDirectory = path.join(webDirectory, 'public', 'data')
const deckOutputDirectory = path.join(outputDirectory, 'decks')

const titleMap = {
  ai102: 'Microsoft Azure AI Engineer Associate',
  ai900: 'Microsoft Azure AI Fundamentals',
  az104: 'Microsoft Azure Administrator',
  az204: 'Developing Solutions for Microsoft Azure',
  az305: 'Designing Microsoft Azure Infrastructure Solutions',
  az500: 'Microsoft Azure Security Technologies',
  gh300: 'GitHub Foundations',
}

const filenamePattern = /^(?<slug>[a-z0-9]+)_flashcards(?:_(?<count>\d+))?_(?<date>\d{4}-\d{2}-\d{2})\.csv$/i

function toDisplayCode(slug) {
  const match = slug.match(/^([a-z]+)(\d+)$/i)

  if (!match) {
    return slug.toUpperCase()
  }

  return `${match[1].toUpperCase()}-${match[2]}`
}

function normalizeLineBreaks(value) {
  return value.replace(/\r\n/g, '\n').trim()
}

function splitCsvLine(line, sourceFile, rowNumber) {
  const fields = []
  let currentField = ''
  let inQuotes = false

  for (let index = 0; index < line.length; index += 1) {
    const character = line[index]
    const nextCharacter = line[index + 1]

    if (character === '"') {
      if (!inQuotes && currentField.length === 0) {
        inQuotes = true
        continue
      }

      if (inQuotes && nextCharacter === '"') {
        currentField += '"'
        index += 1
        continue
      }

      if (inQuotes && (nextCharacter === ',' || nextCharacter === undefined)) {
        inQuotes = false
        continue
      }

      currentField += character
      continue
    }

    if (character === ',' && !inQuotes) {
      fields.push(currentField)
      currentField = ''
      continue
    }

    currentField += character
  }

  fields.push(currentField)

  if (fields.length !== 4) {
    throw new Error(`${sourceFile} row ${rowNumber}: Expected 4 columns, found ${fields.length}`)
  }

  return {
    Front: fields[0],
    Back: fields[1],
    Extra: fields[2],
    Tags: fields[3],
  }
}

function parseFront(front, sourceFile, rowNumber) {
  const marker = '<br><br>'
  const markerIndex = front.indexOf(marker)

  if (markerIndex === -1) {
    throw new Error(`${sourceFile} row ${rowNumber}: Front field is missing the question/options separator`)
  }

  const promptHtml = front.slice(0, markerIndex).trim()
  const rawOptions = front
    .slice(markerIndex + marker.length)
    .split('<br>')
    .map((option) => option.trim())
    .filter(Boolean)

  if (rawOptions.length !== 3) {
    throw new Error(`${sourceFile} row ${rowNumber}: Expected 3 answer options, found ${rawOptions.length}`)
  }

  const options = rawOptions.map((option) => {
    const match = option.match(/^([A-C])\)\s*(.+)$/s)

    if (!match) {
      throw new Error(`${sourceFile} row ${rowNumber}: Option is not in A/B/C format`)
    }

    return {
      key: match[1],
      label: match[2].trim(),
    }
  })

  return {
    promptHtml,
    options,
  }
}

function parseBack(back, sourceFile, rowNumber) {
  const match = back.match(/^([A-C])\)\s*(.+?)(?:<br\s*\/?>|$)([\s\S]*)$/i)

  if (!match) {
    throw new Error(`${sourceFile} row ${rowNumber}: Back field must start with A), B), or C)`)
  }

  const rationaleHtml = normalizeLineBreaks(match[3] ?? '')
    .replace(/^(<br\s*\/?>)+/i, '')
    .trim()

  return {
    correctOption: match[1].toUpperCase(),
    correctLabel: match[2].trim(),
    rationaleHtml,
  }
}

function parseTags(tags) {
  const tagParts = tags.split(/\s+/).filter(Boolean)
  const domain = tagParts[1] ?? 'General'
  const topic = tagParts.length > 2 ? tagParts.slice(2).join(' ') : domain

  return {
    tags: tagParts,
    domain,
    topic,
  }
}

function buildQuestionId(slug, front, back) {
  const hash = createHash('sha1')
    .update(`${slug}:${front}:${back}`)
    .digest('hex')
    .slice(0, 12)

  return `${slug}-${hash}`
}

function pickPreferredFile(currentFile, nextFile) {
  if (!currentFile) {
    return nextFile
  }

  if (nextFile.date > currentFile.date) {
    return nextFile
  }

  if (nextFile.date < currentFile.date) {
    return currentFile
  }

  if (nextFile.count > currentFile.count) {
    return nextFile
  }

  if (nextFile.count < currentFile.count) {
    return currentFile
  }

  return nextFile.filename > currentFile.filename ? nextFile : currentFile
}

async function buildFlashcardData() {
  const filenames = await readdir(flashcardsDirectory)
  const latestDecks = new Map()

  for (const filename of filenames) {
    const match = filename.match(filenamePattern)

    if (!match?.groups) {
      continue
    }

    const candidate = {
      filename,
      slug: match.groups.slug.toLowerCase(),
      count: Number(match.groups.count ?? '0'),
      date: match.groups.date,
    }

    latestDecks.set(candidate.slug, pickPreferredFile(latestDecks.get(candidate.slug), candidate))
  }

  await mkdir(deckOutputDirectory, { recursive: true })

  // Keep translated decks (e.g. *-fr.json) intact; only clear generated EN decks.
  const existingDeckFiles = await readdir(deckOutputDirectory)
  await Promise.all(
    existingDeckFiles
      .filter((name) => /^[a-z0-9]+\.json$/i.test(name) && !/-[a-z]{2}\.json$/i.test(name))
      .map((name) => rm(path.join(deckOutputDirectory, name), { force: true })),
  )

  const manifest = {
    generatedAt: new Date().toISOString(),
    exams: [],
  }

  for (const selectedDeck of [...latestDecks.values()].sort((left, right) => left.slug.localeCompare(right.slug))) {
    const sourcePath = path.join(flashcardsDirectory, selectedDeck.filename)
    const source = await readFile(sourcePath, 'utf8')
    const lines = source
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)

    if (lines[0] !== 'Front,Back,Extra,Tags') {
      throw new Error(`${selectedDeck.filename}: Unexpected CSV header`)
    }

    const rows = lines.slice(1).map((line, index) => splitCsvLine(line, selectedDeck.filename, index + 2))

    const questions = []
    const domains = new Set()
    const topics = new Set()
    const duplicateIds = new Set()

    rows.forEach((row, index) => {
      if (!row.Front || !row.Back || !row.Extra || !row.Tags) {
        throw new Error(`${selectedDeck.filename} row ${index + 2}: Missing one of Front, Back, Extra, or Tags`)
      }

      const { promptHtml, options } = parseFront(normalizeLineBreaks(row.Front), selectedDeck.filename, index + 2)
      const { correctOption, correctLabel, rationaleHtml } = parseBack(
        normalizeLineBreaks(row.Back),
        selectedDeck.filename,
        index + 2,
      )
      const { tags, domain, topic } = parseTags(normalizeLineBreaks(row.Tags))
      const extraHtml = normalizeLineBreaks(row.Extra)
      const questionId = buildQuestionId(selectedDeck.slug, row.Front, row.Back)

      if (duplicateIds.has(questionId)) {
        throw new Error(`${selectedDeck.filename} row ${index + 2}: Duplicate question detected`)
      }

      duplicateIds.add(questionId)
      domains.add(domain)
      topics.add(topic)

      questions.push({
        id: questionId,
        examSlug: selectedDeck.slug,
        domain,
        topic,
        tags,
        promptHtml,
        options,
        correctOption,
        correctLabel,
        rationaleHtml,
        extraHtml,
      })
    })

    const exam = {
      slug: selectedDeck.slug,
      code: toDisplayCode(selectedDeck.slug),
      title: titleMap[selectedDeck.slug] ?? toDisplayCode(selectedDeck.slug),
      sourceFile: selectedDeck.filename,
      updatedOn: selectedDeck.date,
      questionCount: questions.length,
      domains: [...domains].sort(),
      topics: [...topics].sort(),
    }

    manifest.exams.push(exam)

    await writeFile(
      path.join(deckOutputDirectory, `${selectedDeck.slug}.json`),
      JSON.stringify({ exam, questions }, null, 2),
    )
  }

  await writeFile(path.join(outputDirectory, 'exams.json'), JSON.stringify(manifest, null, 2))
}

buildFlashcardData().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})