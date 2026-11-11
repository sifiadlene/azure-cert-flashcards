import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import {
  SOURCE_PAGE_URL,
  buildCatalogCandidate,
  createReviewReport,
  describeCatalogChanges,
  parseAvailabilityCatalog,
  readJson,
  serializeJson,
  validateCatalog,
} from './exam-catalog.mjs'

const toolsDirectory = path.dirname(fileURLToPath(import.meta.url))
const repositoryDirectory = path.resolve(toolsDirectory, '..')
const defaultOutput = path.join(repositoryDirectory, 'catalog', 'microsoft-learn-practice-assessments.json')

function parseArguments(arguments_) {
  const options = {
    input: undefined, output: defaultOutput, retrievedAt: undefined, check: false,
    candidate: undefined, report: undefined, baseSha: undefined,
  }

  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index]
    if (argument === '--check') {
      options.check = true
      continue
    }
    if (!['--input', '--output', '--retrieved-at', '--candidate', '--report', '--base-sha'].includes(argument)) {
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
    if (argument === '--candidate') options.candidate = path.resolve(value)
    if (argument === '--report') options.report = path.resolve(value)
    if (argument === '--base-sha') options.baseSha = value
  }

  if (options.candidate || options.report || options.baseSha) {
    if (!options.check || !options.candidate || !options.report || !options.baseSha) {
      throw new Error('--candidate, --report and --base-sha must be supplied together with --check')
    }
    if (options.candidate === options.report) {
      throw new Error('Candidate and report must use different paths')
    }
    for (const output of [options.candidate, options.report]) {
      const relative = path.relative(repositoryDirectory, output)
      if (!relative || (!relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))) {
        throw new Error('Candidate and report must be written outside the repository')
      }
    }
  }

  return options
}

export async function loadHtml(input, fetchSource = fetch) {
  if (input) {
    return readFile(input, 'utf8')
  }

  const response = await fetchSource(SOURCE_PAGE_URL, {
    headers: { accept: 'text/html', 'user-agent': 'certification-flashcards-catalog-refresh/1.0' },
    redirect: 'error',
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
    existingCatalog = validateCatalog(await readJson(options.output))
  } catch (error) {
    if (options.check || error?.code !== 'ENOENT') {
      throw error
    }
  }

  const html = await loadHtml(options.input)
  const checkedAt = options.retrievedAt ?? new Date().toISOString()
  const retrievedAt = checkedAt
  const parsedCatalog = validateCatalog({
    schemaVersion: 1,
    exams: parseAvailabilityCatalog(html, retrievedAt),
  })
  if (!existingCatalog) {
    await writeFile(options.output, serializeJson(parsedCatalog), { flag: 'wx' })
    console.log(`Wrote ${parsedCatalog.exams.length} catalog entries to ${options.output}`)
    return
  }

  const candidate = buildCatalogCandidate(existingCatalog, parsedCatalog)
  const candidateBytes = serializeJson(candidate)
  const changes = describeCatalogChanges(existingCatalog, candidate)
  const hasChanges = changes.added.length > 0 || changes.removed.length > 0 || changes.changed.length > 0

  if (options.candidate) {
    const report = createReviewReport(existingCatalog, candidate, checkedAt, options.baseSha, candidateBytes)
    await writeFile(options.candidate, candidateBytes, { flag: 'wx' })
    await writeFile(options.report, serializeJson(report), { flag: 'wx' })
  }

  if (hasChanges) {
    console.log(`Catalog changes require review (checked ${checkedAt}):`)
    console.log(serializeJson(changes))
    process.exitCode = 2
    return
  }

  console.log(`Catalog verified at ${checkedAt}: ${candidate.exams.length} entries, no semantic changes.`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
}
