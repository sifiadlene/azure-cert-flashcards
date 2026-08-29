import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const apiRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const repositoryRoot = join(apiRoot, '..')
const source = join(apiRoot, '..', 'web', 'public', 'data', 'decks')
const destination = join(apiRoot, 'data', 'decks')
const sharedDataFiles = [
  'microsoft-learn-practice-assessments.json',
  'supported-exam-codes.json',
]

if (!existsSync(source)) {
  throw new Error(`Canonical deck directory not found: ${source}`)
}

rmSync(destination, { recursive: true, force: true })
mkdirSync(destination, { recursive: true })

const englishDecks = readdirSync(source)
  .filter((name) => name.endsWith('.json') && !name.endsWith('-fr.json'))
  .sort()

if (englishDecks.length === 0) {
  throw new Error('No canonical English decks were found.')
}

for (const name of englishDecks) {
  cpSync(join(source, name), join(destination, name))
}

for (const name of sharedDataFiles) {
  const sharedSource = join(repositoryRoot, 'catalog', name)
  if (!existsSync(sharedSource)) {
    throw new Error(`Canonical shared data file not found: ${sharedSource}`)
  }
  cpSync(sharedSource, join(apiRoot, 'data', name))
}

console.log(`Copied ${englishDecks.length} canonical English decks and ${sharedDataFiles.length} shared data files without regenerating source data.`)
