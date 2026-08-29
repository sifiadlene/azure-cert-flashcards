import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse } from 'csv-parse/sync'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url))
const webDirectory = path.resolve(scriptDirectory, '..')
const repositoryDirectory = path.resolve(webDirectory, '..')
const flashcardsDirectory = path.join(repositoryDirectory, 'flashcards')
const decksDirectory = path.join(webDirectory, 'public', 'data', 'decks')
const execFileAsync = promisify(execFile)

const GH300_SOURCE = 'gh300_flashcards_2026-08-28.csv'
const GH300_COVERAGE = 'gh300_coverage_2026-08-28.json'
const OFFICIAL_HOSTS = new Set(['docs.github.com', 'learn.microsoft.com'])
const REQUIRED_BULLETS = new Set([
  'RAI-01', 'RAI-02', 'RAI-03', 'RAI-04', 'RAI-05',
  'FEAT-IDE-01', 'FEAT-IDE-02', 'FEAT-IDE-03',
  'FEAT-CLI-01', 'FEAT-CLI-02', 'FEAT-CLI-03', 'FEAT-CLI-04', 'FEAT-CLI-05',
  'FEAT-CAP-01', 'FEAT-CAP-02', 'FEAT-CAP-03', 'FEAT-CAP-04', 'FEAT-CAP-05',
  'FEAT-ORG-01', 'FEAT-ORG-02', 'FEAT-ORG-03',
  'DATA-01', 'DATA-02', 'DATA-03', 'DATA-04', 'DATA-05',
  'PROMPT-01', 'PROMPT-02', 'PROMPT-03', 'PROMPT-04', 'PROMPT-05', 'PROMPT-06',
  'PROD-01', 'PROD-02', 'PROD-03', 'PROD-04', 'PROD-05', 'PROD-06',
  'PRIV-01', 'PRIV-02', 'PRIV-03', 'PRIV-04',
])
const DOMAIN_TARGETS = {
  ResponsibleAI: 18,
  CopilotFeatures: 29,
  DataArchitecture: 13,
  PromptEngineering: 13,
  DeveloperProductivity: 13,
  PrivacySafeguards: 14,
}
const TOPIC_TARGETS = {
  ResponsibleAIPrinciples: 10,
  ValidateOperateAITools: 8,
  CopilotIDE: 5,
  CopilotCLI: 6,
  FeaturesCapabilities: 12,
  OrganizationPolicies: 6,
  DataHandlingFlow: 8,
  LifecycleLimitations: 5,
  CraftEffectivePrompts: 8,
  EngineerPrompts: 5,
  ProductivityCodeQuality: 7,
  TestingSecurity: 6,
  PrivacyExclusions: 8,
  SafeguardsTroubleshooting: 6,
}
const ANSWER_TARGETS = { A: 34, B: 33, C: 33 }
// Guards against the "pick the longest option" tell: the correct answer must not
// be visually distinguishable by length across the deck or on any single card.
const LENGTH_GUARD = { maxLongestShare: 0.4, maxOptionRatio: 1.6 }
export const CHALLENGE_QUESTION_COUNTS = [5, 10, 20]

function increment(counter, key) {
  counter[key] = (counter[key] ?? 0) + 1
}

function optionLength(text) {
  return text.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim().length
}

function expectEqual(errors, label, actual, expected) {
  if (actual !== expected) {
    errors.push(`${label}: expected ${expected}, found ${actual}`)
  }
}

function extractReferenceUrl(back) {
  return back.match(/Reference:\s*<a href="([^"]+)"/i)?.[1] ?? ''
}

async function validateGh300() {
  const errors = []
  const csvPath = path.join(flashcardsDirectory, GH300_SOURCE)
  const coveragePath = path.join(flashcardsDirectory, GH300_COVERAGE)
  const rows = parse(await readFile(csvPath, 'utf8'), {
    bom: true,
    columns: true,
    skip_empty_lines: true,
    trim: true,
  })
  const coverage = JSON.parse(await readFile(coveragePath, 'utf8'))

  expectEqual(errors, 'Card count', rows.length, 100)
  expectEqual(errors, 'Coverage card count', coverage.cards?.length, 100)
  expectEqual(errors, 'Coverage source file', coverage.sourceFile, GH300_SOURCE)
  expectEqual(errors, 'Coverage exam', coverage.exam, 'GH-300')

  const domains = {}
  const topics = {}
  const answers = {}
  const lengthStats = { total: 0, correctLongest: 0 }
  const fronts = new Set()
  const coveredBullets = new Set()

  rows.forEach((row, index) => {
    const cardNumber = index + 1
    const prefix = `Card ${cardNumber}`
    const tagParts = row.Tags?.split(/\s+/) ?? []
    const [exam, domain, topic] = tagParts
    const coverageCard = coverage.cards?.[index]
    const options = row.Front?.split('<br><br>')[1]?.split('<br>') ?? []
    const optionMap = Object.fromEntries(options.map((option) => {
      const match = option.match(/^([A-C])\)\s*(.+)$/s)
      return match ? [match[1], match[2].trim()] : ['', '']
    }))
    const answerMatch = row.Back?.match(/^([A-C])\)\s*(.+?)(?:<br>|$)/s)
    const referenceUrl = extractReferenceUrl(row.Back ?? '')

    if (!row.Front || !row.Back || !row.Extra || !row.Tags) {
      errors.push(`${prefix}: all four CSV fields are required`)
    }
    if (fronts.has(row.Front)) {
      errors.push(`${prefix}: duplicate Front field`)
    }
    fronts.add(row.Front)

    expectEqual(errors, `${prefix} option count`, options.length, 3)
    if (Object.keys(optionMap).filter(Boolean).join('') !== 'ABC') {
      errors.push(`${prefix}: options must be labeled A), B), and C) in order`)
    }
    if (!answerMatch) {
      errors.push(`${prefix}: Back must start with A), B), or C)`)
    } else {
      const [, answer, correctLabel] = answerMatch
      increment(answers, answer)
      if (optionMap[answer] !== correctLabel.trim()) {
        errors.push(`${prefix}: Back label does not match option ${answer}`)
      }

      const optionLengths = ['A', 'B', 'C'].map((key) => optionLength(optionMap[key] ?? ''))
      if (optionLengths.every((length) => length > 0)) {
        const correctLength = optionLengths[{ A: 0, B: 1, C: 2 }[answer]]
        const median = [...optionLengths].sort((first, second) => first - second)[1]
        const ratio = median > 0 ? correctLength / median : 1
        lengthStats.total += 1
        if (correctLength === Math.max(...optionLengths)) {
          lengthStats.correctLongest += 1
        }
        if (ratio > LENGTH_GUARD.maxOptionRatio) {
          errors.push(`${prefix}: correct option is ${ratio.toFixed(2)}x the median option length (max ${LENGTH_GUARD.maxOptionRatio}x); lengthen distractors`)
        }
      }
    }

    if (tagParts.length !== 3 || exam !== 'GH-300') {
      errors.push(`${prefix}: Tags must be exactly "GH-300 Domain Topic"`)
    }
    increment(domains, domain)
    increment(topics, topic)

    if (!referenceUrl) {
      errors.push(`${prefix}: Back is missing a Reference link`)
    } else {
      try {
        if (!OFFICIAL_HOSTS.has(new URL(referenceUrl).hostname)) {
          errors.push(`${prefix}: reference must use an official documentation host`)
        }
      } catch {
        errors.push(`${prefix}: reference URL is invalid`)
      }
    }

    if (!coverageCard || coverageCard.cardNumber !== cardNumber) {
      errors.push(`${prefix}: coverage manifest order/cardNumber mismatch`)
    } else {
      if (!REQUIRED_BULLETS.has(coverageCard.bulletId)) {
        errors.push(`${prefix}: unknown bullet ID ${coverageCard.bulletId}`)
      }
      coveredBullets.add(coverageCard.bulletId)
      if (coverageCard.sourceUrl !== referenceUrl) {
        errors.push(`${prefix}: coverage source URL does not match the card reference`)
      }
    }
  })

  for (const [domain, target] of Object.entries(DOMAIN_TARGETS)) {
    expectEqual(errors, `Domain ${domain}`, domains[domain] ?? 0, target)
  }
  for (const [topic, target] of Object.entries(TOPIC_TARGETS)) {
    expectEqual(errors, `Topic ${topic}`, topics[topic] ?? 0, target)
  }
  for (const [answer, target] of Object.entries(ANSWER_TARGETS)) {
    expectEqual(errors, `Correct answer ${answer}`, answers[answer] ?? 0, target)
  }
  for (const bullet of REQUIRED_BULLETS) {
    if (!coveredBullets.has(bullet)) {
      errors.push(`Coverage: missing required bullet ${bullet}`)
    }
  }

  const longestShare = lengthStats.total > 0 ? lengthStats.correctLongest / lengthStats.total : 0
  if (longestShare > LENGTH_GUARD.maxLongestShare) {
    errors.push(`Answer-length bias: correct option is longest in ${lengthStats.correctLongest}/${lengthStats.total} cards (${Math.round(longestShare * 100)}%); must be <= ${Math.round(LENGTH_GUARD.maxLongestShare * 100)}%`)
  }

  return {
    errors,
    domains,
    topics,
    answers,
    coveredBullets: coveredBullets.size,
    lengthBias: { correctLongest: lengthStats.correctLongest, total: lengthStats.total, share: Number(longestShare.toFixed(2)) },
  }
}

function sameValues(left, right) {
  return JSON.stringify(left) === JSON.stringify(right)
}

export function validateDeckParity(englishDeck, frenchDeck, slug = englishDeck?.exam?.slug ?? 'unknown') {
  const errors = []
  const englishQuestions = Array.isArray(englishDeck?.questions) ? englishDeck.questions : []
  const frenchQuestions = Array.isArray(frenchDeck?.questions) ? frenchDeck.questions : []
  const englishDeckVersion = englishDeck?.exam?.deckVersion ?? englishDeck?.exam?.updatedOn
  const frenchDeckVersion = frenchDeck?.exam?.deckVersion ?? frenchDeck?.exam?.updatedOn

  expectEqual(errors, `${slug} exam slug`, frenchDeck?.exam?.slug, englishDeck?.exam?.slug)
  expectEqual(errors, `${slug} exam code`, frenchDeck?.exam?.code, englishDeck?.exam?.code)
  expectEqual(errors, `${slug} source file`, frenchDeck?.exam?.sourceFile, englishDeck?.exam?.sourceFile)
  expectEqual(errors, `${slug} deck version`, frenchDeckVersion, englishDeckVersion)
  expectEqual(errors, `${slug} updated date`, frenchDeck?.exam?.updatedOn, englishDeck?.exam?.updatedOn)
  expectEqual(errors, `${slug} declared question count`, frenchDeck?.exam?.questionCount, englishDeck?.exam?.questionCount)
  expectEqual(errors, `${slug} English declared/actual count`, englishDeck?.exam?.questionCount, englishQuestions.length)
  expectEqual(errors, `${slug} French declared/actual count`, frenchDeck?.exam?.questionCount, frenchQuestions.length)
  if (!sameValues(frenchDeck?.exam?.domains, englishDeck?.exam?.domains)) {
    errors.push(`${slug}: exam domains do not match`)
  }
  if (!sameValues(frenchDeck?.exam?.topics, englishDeck?.exam?.topics)) {
    errors.push(`${slug}: exam topics do not match`)
  }

  const englishIds = new Set()
  const frenchIds = new Set()
  englishQuestions.forEach((question) => {
    if (englishIds.has(question.id)) {
      errors.push(`${slug}: duplicate English question ID ${question.id}`)
    }
    englishIds.add(question.id)
  })
  frenchQuestions.forEach((question) => {
    if (frenchIds.has(question.id)) {
      errors.push(`${slug}: duplicate French question ID ${question.id}`)
    }
    frenchIds.add(question.id)
  })

  const questionCount = Math.max(englishQuestions.length, frenchQuestions.length)
  for (let index = 0; index < questionCount; index += 1) {
    const english = englishQuestions[index]
    const french = frenchQuestions[index]
    const label = `${slug} question ${index + 1}`

    if (!english || !french) {
      errors.push(`${label}: missing ${english ? 'French' : 'English'} question`)
      continue
    }

    expectEqual(errors, `${label} ID`, french.id, english.id)
    expectEqual(errors, `${label} exam slug`, french.examSlug, english.examSlug)
    expectEqual(errors, `${label} domain`, french.domain, english.domain)
    expectEqual(errors, `${label} topic`, french.topic, english.topic)
    expectEqual(errors, `${label} correct option`, french.correctOption, english.correctOption)
    if (!sameValues(french.tags, english.tags)) {
      errors.push(`${label}: tags do not match`)
    }

    const englishOptionKeys = Array.isArray(english.options) ? english.options.map(({ key }) => key) : []
    const frenchOptionKeys = Array.isArray(french.options) ? french.options.map(({ key }) => key) : []
    if (!sameValues(frenchOptionKeys, englishOptionKeys)) {
      errors.push(`${label} option keys: expected ${englishOptionKeys.join(',')}, found ${frenchOptionKeys.join(',')}`)
    }
  }

  return errors
}

export function summarizeChallengePools(deck) {
  const questions = Array.isArray(deck?.questions) ? deck.questions : []
  const poolSizes = new Map([['all', questions.length]])

  questions.forEach((question) => {
    if (typeof question.domain === 'string' && question.domain) {
      poolSizes.set(question.domain, (poolSizes.get(question.domain) ?? 0) + 1)
    }
  })

  return [...poolSizes.entries()]
    .sort(([left], [right]) => left === 'all' ? -1 : right === 'all' ? 1 : left.localeCompare(right))
    .map(([scope, availableQuestionCount]) => ({
      scope,
      availableQuestionCount,
      supportedCounts: CHALLENGE_QUESTION_COUNTS.filter((count) => availableQuestionCount >= count),
    }))
}

export async function validateGeneratedDecks(directory = decksDirectory) {
  const errors = []
  const pools = {}
  const filenames = await readdir(directory)
  const englishFilenames = filenames.filter((filename) => /^[a-z0-9]+\.json$/i.test(filename))
  const frenchSlugs = new Set(
    filenames
      .map((filename) => filename.match(/^([a-z0-9]+)-fr\.json$/i)?.[1]?.toLowerCase())
      .filter(Boolean),
  )

  for (const filename of englishFilenames.sort()) {
    const slug = path.basename(filename, '.json').toLowerCase()
    const frenchFilename = `${slug}-fr.json`
    if (!frenchSlugs.has(slug)) {
      errors.push(`${slug}: missing French deck ${frenchFilename}`)
      continue
    }

    const [englishDeck, frenchDeck] = await Promise.all([
      readFile(path.join(directory, filename), 'utf8').then(JSON.parse),
      readFile(path.join(directory, frenchFilename), 'utf8').then(JSON.parse),
    ])
    errors.push(...validateDeckParity(englishDeck, frenchDeck, slug))
    pools[slug] = summarizeChallengePools(englishDeck)
    frenchSlugs.delete(slug)
  }

  for (const orphanedSlug of [...frenchSlugs].sort()) {
    errors.push(`${orphanedSlug}: French deck has no matching English deck`)
  }

  return { errors, pools }
}

async function main() {
  await execFileAsync(process.execPath, [path.join(repositoryDirectory, 'tools', 'validate-exam-data.mjs')])
  const [result, generatedDecks] = await Promise.all([
    validateGh300(),
    validateGeneratedDecks(),
  ])
  const errors = [...result.errors, ...generatedDecks.errors]

  if (errors.length > 0) {
    console.error(`Flashcard validation failed with ${errors.length} error(s):`)
    errors.forEach((error) => console.error(`- ${error}`))
    process.exitCode = 1
    return
  }

  console.log('GH-300 validation passed')
  console.log(JSON.stringify({
    domains: result.domains,
    topics: result.topics,
    answers: result.answers,
    coveredBullets: result.coveredBullets,
    lengthBias: result.lengthBias,
  }, null, 2))
  console.log('Generated English/French deck parity passed')
  console.log('Challenge pool support (small pools are reported, not rejected)')
  console.log(JSON.stringify(generatedDecks.pools, null, 2))
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
}
