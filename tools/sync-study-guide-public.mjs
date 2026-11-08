import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { validateGuideSnapshot } from './exam-date-report.mjs'

const repositoryDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const sourcePath = path.join(repositoryDirectory, 'catalog', 'study-guide-dates.json')
const publicPath = path.join(repositoryDirectory, 'web', 'public', 'data', 'study-guide-dates.json')

async function main() {
  const args = process.argv.slice(2)
  if (args.length > 1 || (args.length === 1 && args[0] !== '--check')) {
    throw new Error('Usage: node tools/sync-study-guide-public.mjs [--check]')
  }

  const source = await readFile(sourcePath)
  const snapshot = JSON.parse(source.toString('utf8'))
  if (snapshot?.schemaVersion !== 1 || !Array.isArray(snapshot.exams) || snapshot.exams.length === 0) {
    throw new Error('Study guide snapshot must use schemaVersion 1 and contain exams')
  }
  const decks = snapshot.exams.map((exam) => {
    if (!exam || typeof exam.code !== 'string') throw new Error('Study guide snapshot contains an invalid exam')
    return { code: exam.code }
  })
  if (decks.some((deck, index) => index > 0 && deck.code <= decks[index - 1].code)) {
    throw new Error('Study guide snapshot codes must be unique and sorted')
  }
  validateGuideSnapshot(snapshot, decks)

  if (args[0] === '--check') {
    const publicCopy = await readFile(publicPath)
    if (!source.equals(publicCopy)) {
      throw new Error('Study guide public snapshot differs from the canonical snapshot; run node tools/sync-study-guide-public.mjs')
    }
    console.log('Study guide public snapshot is current')
    return
  }

  await writeFile(publicPath, source)
  console.log('Synchronized study guide public snapshot')
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
