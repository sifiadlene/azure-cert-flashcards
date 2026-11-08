import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import { readReportDecks, renderExamDateReport } from './exam-date-report.mjs'

const repositoryDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

describe('committed exam date report', () => {
  it('covers every local deck and matches the committed snapshot', async () => {
    const localDecks = await readReportDecks(repositoryDirectory)
    const localSnapshot = JSON.parse(await readFile(path.join(repositoryDirectory, 'catalog/study-guide-dates.json'), 'utf8'))
    const report = await readFile(path.join(repositoryDirectory, 'EXAM-DATE-REPORT.md'), 'utf8')
    assert.equal(report, renderExamDateReport(localDecks, localSnapshot))
    assert.equal(report.split('\n').filter((line) => line.startsWith('| [')).length, localDecks.length)
  })
})
