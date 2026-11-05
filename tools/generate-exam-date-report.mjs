import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { readJson } from './exam-catalog.mjs'
import { readReportDecks, renderExamDateReport } from './exam-date-report.mjs'

const repositoryDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

async function main() {
  const args = process.argv.slice(2)
  if (args.length && (args.length !== 1 || args[0] !== '--check')) {
    throw new Error('Usage: node tools/generate-exam-date-report.mjs [--check]')
  }
  const decks = await readReportDecks(repositoryDirectory)
  const snapshot = await readJson(path.join(repositoryDirectory, 'catalog/study-guide-dates.json'))
  const report = renderExamDateReport(decks, snapshot)
  const output = path.join(repositoryDirectory, 'EXAM-DATE-REPORT.md')
  if (args[0] === '--check') {
    if (await readFile(output, 'utf8') !== report) throw new Error('Exam date report drift; run node tools/generate-exam-date-report.mjs')
    console.log(`Exam date report is current with ${decks.length} exams.`)
  } else {
    await writeFile(output, report)
    console.log(`Wrote exam date report for ${decks.length} exams to ${output}`)
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
