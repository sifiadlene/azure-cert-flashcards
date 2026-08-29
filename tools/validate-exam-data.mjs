import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  CURRENT_CATALOG_SIZE,
  buildSupportedExamCodes,
  computeRequestableExams,
  readJson,
  serializeJson,
  validateCatalog,
} from './exam-catalog.mjs'

const toolsDirectory = path.dirname(fileURLToPath(import.meta.url))
const repositoryDirectory = path.resolve(toolsDirectory, '..')
const catalogPath = path.join(repositoryDirectory, 'catalog', 'microsoft-learn-practice-assessments.json')
const supportedPath = path.join(repositoryDirectory, 'catalog', 'supported-exam-codes.json')
const webDataDirectory = path.join(repositoryDirectory, 'web', 'public', 'data')
const apiDataDirectory = path.join(repositoryDirectory, 'api', 'data')
const manifestPath = path.join(webDataDirectory, 'exams.json')

async function assertExactCopy(sourcePath, copyPath) {
  const [source, copy] = await Promise.all([
    readFile(sourcePath, 'utf8'),
    readFile(copyPath, 'utf8'),
  ])
  if (source !== copy) {
    throw new Error(`Generated data drift detected: ${copyPath} does not match ${sourcePath}`)
  }
}

async function main() {
  const [catalog, supported, manifest] = await Promise.all([
    readJson(catalogPath),
    readJson(supportedPath),
    readJson(manifestPath),
  ])
  validateCatalog(catalog, CURRENT_CATALOG_SIZE)

  const expectedSupported = buildSupportedExamCodes(manifest)
  if (serializeJson(supported) !== serializeJson(expectedSupported)) {
    throw new Error('Supported exam codes drifted from web/public/data/exams.json')
  }

  await Promise.all([
    assertExactCopy(catalogPath, path.join(webDataDirectory, path.basename(catalogPath))),
    assertExactCopy(catalogPath, path.join(apiDataDirectory, path.basename(catalogPath))),
    assertExactCopy(supportedPath, path.join(webDataDirectory, path.basename(supportedPath))),
    assertExactCopy(supportedPath, path.join(apiDataDirectory, path.basename(supportedPath))),
  ])

  const requestable = computeRequestableExams(catalog, supported)
  console.log(`Exam data validation passed: ${catalog.exams.length} catalog, ${supported.codes.length} supported, ${requestable.length} requestable.`)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
