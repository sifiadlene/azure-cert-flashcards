import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { validateGuideSnapshot } from './exam-date-report.mjs'

const repositoryDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const sourcePath = path.join(repositoryDirectory, 'catalog', 'study-guide-dates.json')
const publicPath = path.join(repositoryDirectory, 'web', 'public', 'data', 'study-guide-dates.json')
const reviewsSourcePath = path.join(repositoryDirectory, 'catalog', 'study-guide-reviews.json')
const reviewsPublicPath = path.join(repositoryDirectory, 'web', 'public', 'data', 'study-guide-reviews.json')

function isCalendarDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T00:00:00.000Z`)
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
}

function validateStudyGuideReviews(reviews) {
  if (reviews?.schemaVersion !== 1 || !Array.isArray(reviews.reviews)) {
    throw new Error('Study-guide reviews must use schemaVersion 1 and contain reviews')
  }
  const codes = new Set()
  for (const review of reviews.reviews) {
    if (!review || typeof review.code !== 'string' || !/^[A-Z]{2}-\d{3}$/.test(review.code)
      || review.guideUrl !== `https://learn.microsoft.com/en-us/credentials/certifications/resources/study-guides/${review.code.toLowerCase()}`
      || !isCalendarDate(review.guideUpdatedOn)
      || !isCalendarDate(review.deckVersion)
      || !isCalendarDate(review.reviewedOn)
      || (review.status !== 'aligned' && review.status !== 'gaps')
      || codes.has(review.code)) {
      throw new Error('Study-guide reviews contain an invalid or duplicate entry')
    }
    codes.add(review.code)
  }
}

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
  const reviewsSource = await readFile(reviewsSourcePath)
  validateStudyGuideReviews(JSON.parse(reviewsSource.toString('utf8')))
  const reviewsPublic = await readFile(reviewsPublicPath)
  if (!reviewsSource.equals(reviewsPublic)) {
    throw new Error('Study-guide review public snapshot differs from the canonical snapshot; update the public copy alongside the canonical file')
  }

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
