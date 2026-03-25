#!/usr/bin/env node
/**
 * translate-decks.mjs
 *
 * Translates all English flashcard JSON decks to French using Azure AI Translator.
 * Generates {slug}-fr.json alongside each {slug}.json in web/public/data/decks/.
 *
 * Usage:
 *   AZURE_TRANSLATOR_KEY=<key> AZURE_TRANSLATOR_REGION=<region> node tools/translate-decks.mjs
 *   node tools/translate-decks.mjs --key <key> --region <region> [--force]
 *
 * Options:
 *   --key     Azure Translator API key (overrides AZURE_TRANSLATOR_KEY env var)
 *   --region  Azure resource region, e.g. eastus (overrides AZURE_TRANSLATOR_REGION env var)
 *   --force   Overwrite existing French deck files (default: skip already translated decks)
 *   --deck    Only translate the specified exam slug (e.g. --deck ai900)
 *
 * See tools/README.md for full setup instructions and cost estimates.
 */

import { existsSync } from 'node:fs'
import { readdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url))
const repositoryDirectory = path.resolve(scriptDirectory, '..')
const decksDirectory = path.join(repositoryDirectory, 'web', 'public', 'data', 'decks')

const AZURE_TRANSLATOR_ENDPOINT = 'https://api.cognitive.microsofttranslator.com'
const SOURCE_LANGUAGE = 'en'
const TARGET_LANGUAGE = 'fr'

/** Max texts per API request (Azure limit: 100). */
const BATCH_SIZE = 100

/**
 * Conservative character cap per request payload to avoid Azure size-limit errors.
 * The service also enforces request-size limits, not only item count.
 */
const BATCH_CHAR_LIMIT = 45_000

/** Delay between API batches in ms to avoid throttling on free tiers. */
const BATCH_DELAY_MS = 150

// ─── CLI argument parsing ───────────────────────────────────────────────────

function parseArgs() {
  const args = process.argv.slice(2)
  const result = {
    key: process.env.AZURE_TRANSLATOR_KEY ?? '',
    region: process.env.AZURE_TRANSLATOR_REGION ?? '',
    force: false,
    deckFilter: '',
  }

  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '--key' && args[i + 1]) {
      result.key = args[++i]
    } else if (args[i] === '--region' && args[i + 1]) {
      result.region = args[++i]
    } else if (args[i] === '--force') {
      result.force = true
    } else if (args[i] === '--deck' && args[i + 1]) {
      result.deckFilter = args[++i]
    }
  }

  return result
}

// ─── Azure Translator API helpers ──────────────────────────────────────────

/**
 * Translates a batch of text strings using Azure AI Translator.
 *
 * @param {string[]} texts - Texts to translate (max 100 per call, 50 000 chars total)
 * @param {string} key - Azure Translator subscription key
 * @param {string} region - Azure resource region
 * @param {'plain' | 'html'} textType - Whether texts contain HTML markup
 * @returns {Promise<string[]>} Translated strings in the same order
 */
async function translateBatch(texts, key, region, textType) {
  const url = new URL('/translate', AZURE_TRANSLATOR_ENDPOINT)
  url.searchParams.set('api-version', '3.0')
  url.searchParams.set('from', SOURCE_LANGUAGE)
  url.searchParams.set('to', TARGET_LANGUAGE)
  url.searchParams.set('textType', textType)

  const response = await fetch(url.toString(), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json; charset=UTF-8',
      'Ocp-Apim-Subscription-Key': key,
      'Ocp-Apim-Subscription-Region': region,
    },
    body: JSON.stringify(texts.map((text) => ({ Text: text }))),
  })

  if (!response.ok) {
    const body = await response.text()
    throw new Error(`Azure Translator API error ${response.status}: ${body}`)
  }

  const results = await response.json()
  return results.map((result) => result.translations[0].text)
}

/**
 * Translates an array of texts in batches, respecting API limits.
 */
async function translateInBatches(texts, key, region, textType) {
  if (texts.length === 0) {
    return []
  }

  const results = []
  const batches = []

  let currentBatch = []
  let currentChars = 0

  for (const text of texts) {
    const textChars = text.length

    if (textChars > BATCH_CHAR_LIMIT) {
      throw new Error(
        `Single text item exceeds batch character limit (${textChars} > ${BATCH_CHAR_LIMIT}).`,
      )
    }

    const wouldExceedCount = currentBatch.length >= BATCH_SIZE
    const wouldExceedChars = currentChars + textChars > BATCH_CHAR_LIMIT

    if (currentBatch.length > 0 && (wouldExceedCount || wouldExceedChars)) {
      batches.push(currentBatch)
      currentBatch = []
      currentChars = 0
    }

    currentBatch.push(text)
    currentChars += textChars
  }

  if (currentBatch.length > 0) {
    batches.push(currentBatch)
  }

  for (let i = 0; i < batches.length; i += 1) {
    const batch = batches[i]
    const translated = await translateBatch(batch, key, region, textType)
    results.push(...translated)

    if (i < batches.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, BATCH_DELAY_MS))
    }
  }

  return results
}

// ─── Deck translation ───────────────────────────────────────────────────────

/**
 * Translates a single deck file and writes the French version.
 *
 * Translation layout (per question, flat arrays):
 *   plainTexts: [correctLabel, optA.label, optB.label, optC.label, ...]
 *   htmlTexts:  [promptHtml, rationaleHtml, extraHtml, ...]
 *
 * This predictable layout allows index-based reconstruction without extra tracking.
 */
async function translateDeck(deckPath, outputPath, key, region, force) {
  if (!force && existsSync(outputPath)) {
    console.log('  Skipped (already exists — use --force to overwrite)')
    return
  }

  const source = JSON.parse(await readFile(deckPath, 'utf8'))
  const { exam, questions } = source

  // Collect plain-text and HTML fields in a consistent per-question order.
  // Plain: correctLabel, then one label per option (always 3).
  // HTML:  promptHtml, rationaleHtml, extraHtml.
  const PLAIN_PER_Q = 4 // correctLabel + 3 option labels
  const HTML_PER_Q = 3 // promptHtml + rationaleHtml + extraHtml

  const plainTexts = []
  const htmlTexts = []

  for (const question of questions) {
    plainTexts.push(question.correctLabel)
    for (const option of question.options) {
      plainTexts.push(option.label)
    }
    htmlTexts.push(question.promptHtml)
    htmlTexts.push(question.rationaleHtml ?? '')
    htmlTexts.push(question.extraHtml ?? '')
  }

  const totalChars = [...plainTexts, ...htmlTexts].reduce((sum, t) => sum + t.length, 0)
  console.log(
    `  ${questions.length} questions | ${plainTexts.length} plain + ${htmlTexts.length} HTML texts | ~${Math.round(totalChars / 1000)}k chars`,
  )

  console.log(`  Translating plain text fields...`)
  const translatedPlain = await translateInBatches(plainTexts, key, region, 'plain')

  console.log(`  Translating HTML fields...`)
  const translatedHtml = await translateInBatches(htmlTexts, key, region, 'html')

  console.log(`  Translating exam title...`)
  const [translatedTitle] = await translateInBatches([exam.title], key, region, 'plain')

  // Reconstruct questions using the same per-question slot layout.
  const translatedQuestions = questions.map((question, qi) => {
    const pb = qi * PLAIN_PER_Q
    const hb = qi * HTML_PER_Q

    return {
      ...question,
      correctLabel: translatedPlain[pb],
      options: question.options.map((option, oi) => ({
        ...option,
        label: translatedPlain[pb + 1 + oi],
      })),
      promptHtml: translatedHtml[hb],
      rationaleHtml: translatedHtml[hb + 1],
      extraHtml: translatedHtml[hb + 2],
    }
  })

  const output = {
    exam: { ...exam, title: translatedTitle },
    questions: translatedQuestions,
  }

  await writeFile(outputPath, JSON.stringify(output, null, 2), 'utf8')
  console.log(`  Written → ${path.basename(outputPath)}`)
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs()

  if (!args.key || !args.region) {
    console.error('Error: Azure Translator credentials are required.\n')
    console.error('Provide them via environment variables:')
    console.error('  AZURE_TRANSLATOR_KEY=<key> AZURE_TRANSLATOR_REGION=<region> node tools/translate-decks.mjs\n')
    console.error('Or via CLI arguments:')
    console.error('  node tools/translate-decks.mjs --key <key> --region <region>\n')
    console.error('See tools/README.md for full setup instructions.')
    process.exitCode = 1
    return
  }

  const allFiles = await readdir(decksDirectory)

  // Only select base English deck files (e.g. ai900.json, not ai900-fr.json)
  const deckFiles = allFiles.filter((name) => /^[a-z0-9]+\.json$/.test(name))

  const selectedDecks = args.deckFilter
    ? deckFiles.filter((name) => name === `${args.deckFilter}.json`)
    : deckFiles

  if (selectedDecks.length === 0) {
    const msg = args.deckFilter
      ? `No deck found for slug "${args.deckFilter}". Available: ${deckFiles.map((f) => f.replace('.json', '')).join(', ')}`
      : 'No English deck JSON files found in ' + decksDirectory
    console.error(msg)
    process.exitCode = 1
    return
  }

  console.log(`\nAzure AI Translator → French`)
  console.log(`Decks to process: ${selectedDecks.map((f) => f.replace('.json', '')).join(', ')}\n`)

  let successCount = 0
  let errorCount = 0

  for (const filename of selectedDecks) {
    const slug = filename.replace('.json', '')
    const deckPath = path.join(decksDirectory, filename)
    const outputPath = path.join(decksDirectory, `${slug}-fr.json`)

    console.log(`[${slug}]`)

    try {
      await translateDeck(deckPath, outputPath, args.key, args.region, args.force)
      successCount += 1
    } catch (error) {
      console.error(`  ERROR: ${error instanceof Error ? error.message : String(error)}`)
      errorCount += 1
    }
  }

  console.log(`\n─────────────────────────────────────────────`)
  console.log(`Done: ${successCount} succeeded, ${errorCount} failed`)

  if (errorCount > 0) {
    process.exitCode = 1
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
