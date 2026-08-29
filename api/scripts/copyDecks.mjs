import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const apiRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const source = join(apiRoot, '..', 'web', 'public', 'data', 'decks')
const destination = join(apiRoot, 'data', 'decks')

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

console.log(`Copied ${englishDecks.length} canonical English decks without regenerating source data.`)
