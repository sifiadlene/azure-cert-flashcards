import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse } from 'csv-parse/sync'

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url))
const webDirectory = path.resolve(scriptDirectory, '..')
const repositoryDirectory = path.resolve(webDirectory, '..')
const flashcardsDirectory = path.join(repositoryDirectory, 'flashcards')

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

async function main() {
  const result = await validateGh300()

  if (result.errors.length > 0) {
    console.error(`GH-300 validation failed with ${result.errors.length} error(s):`)
    result.errors.forEach((error) => console.error(`- ${error}`))
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
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
