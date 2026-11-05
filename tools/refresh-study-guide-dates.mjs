import { randomUUID } from 'node:crypto'
import { readFile, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { serializeJson } from './exam-catalog.mjs'
import { fetchGuideSnapshot, parseStudyGuide, readReportDecks, validateGuideSnapshot } from './exam-date-report.mjs'

const repositoryDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

async function main() {
  let input
  let retrievedAt
  const args = process.argv.slice(2)
  for (let index = 0; index < args.length; index += 2) {
    const value = args[index + 1]
    if (!['--input', '--retrieved-at'].includes(args[index]) || !value || value.startsWith('--')) {
      throw new Error('Usage: node tools/refresh-study-guide-dates.mjs [--input HTML_DIRECTORY --retrieved-at ISO_UTC_TIMESTAMP]')
    }
    if (args[index] === '--input') input = path.resolve(value)
    if (args[index] === '--retrieved-at') retrievedAt = value
  }
  if (input && !retrievedAt) throw new Error('Offline refresh requires --retrieved-at')
  const decks = await readReportDecks(repositoryDirectory)
  let snapshot
  if (input) {
    const exams = []
    for (const deck of decks) {
      exams.push(parseStudyGuide(await readFile(path.join(input, `${deck.code.toLowerCase()}.html`), 'utf8'), deck.code))
    }
    snapshot = validateGuideSnapshot({ schemaVersion: 1, retrievedAt, exams }, decks)
  } else {
    snapshot = await fetchGuideSnapshot(decks, { retrievedAt })
  }
  const output = path.join(repositoryDirectory, 'catalog/study-guide-dates.json')
  const temporary = `${output}.${randomUUID()}.tmp`
  try {
    await writeFile(temporary, serializeJson(snapshot), { flag: 'wx' })
    await rename(temporary, output)
  } finally {
    await rm(temporary, { force: true })
  }
  console.log(`Wrote study guide dates for ${decks.length} exams to ${output}`)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
