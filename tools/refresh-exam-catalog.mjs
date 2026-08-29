import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  CURRENT_CATALOG_SIZE,
  SOURCE_PAGE_URL,
  parseAvailabilityCatalog,
  readJson,
  serializeJson,
  validateCatalog,
} from './exam-catalog.mjs'

const toolsDirectory = path.dirname(fileURLToPath(import.meta.url))
const repositoryDirectory = path.resolve(toolsDirectory, '..')
const defaultOutput = path.join(repositoryDirectory, 'catalog', 'microsoft-learn-practice-assessments.json')

function parseArguments(arguments_) {
  const options = { input: undefined, output: defaultOutput, retrievedAt: undefined, check: false }

  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index]
    if (argument === '--check') {
      options.check = true
      continue
    }
    if (!['--input', '--output', '--retrieved-at'].includes(argument)) {
      throw new Error(`Unknown argument: ${argument}`)
    }
    const value = arguments_[index + 1]
    if (!value) {
      throw new Error(`Missing value for ${argument}`)
    }
    index += 1
    if (argument === '--input') options.input = path.resolve(value)
    if (argument === '--output') options.output = path.resolve(value)
    if (argument === '--retrieved-at') options.retrievedAt = value
  }

  return options
}

async function loadHtml(input) {
  if (input) {
    return readFile(input, 'utf8')
  }

  const response = await fetch(SOURCE_PAGE_URL, {
    headers: { accept: 'text/html', 'user-agent': 'certification-flashcards-catalog-refresh/1.0' },
    signal: AbortSignal.timeout(30_000),
  })
  if (!response.ok) {
    throw new Error(`Microsoft Learn catalog request failed with HTTP ${response.status}`)
  }
  return response.text()
}

async function main() {
  const options = parseArguments(process.argv.slice(2))
  let existingCatalog
  try {
    existingCatalog = validateCatalog(await readJson(options.output), CURRENT_CATALOG_SIZE)
  } catch (error) {
    if (options.check || error?.code !== 'ENOENT') {
      throw error
    }
  }

  const retrievedAt = options.retrievedAt
    ?? (options.check ? existingCatalog.exams[0].retrievedAt : new Date().toISOString())
  const html = await loadHtml(options.input)
  const minimumSize = existingCatalog?.exams.length ?? CURRENT_CATALOG_SIZE
  const catalog = validateCatalog({
    schemaVersion: 1,
    exams: parseAvailabilityCatalog(html, retrievedAt),
  }, minimumSize)
  const serialized = serializeJson(catalog)

  if (options.check) {
    const current = await readFile(options.output, 'utf8')
    if (current !== serialized) {
      throw new Error(`Catalog drift detected: ${options.output}`)
    }
    console.log(`Catalog is current with ${catalog.exams.length} entries.`)
    return
  }

  await writeFile(options.output, serialized)
  console.log(`Wrote ${catalog.exams.length} catalog entries to ${options.output}`)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
