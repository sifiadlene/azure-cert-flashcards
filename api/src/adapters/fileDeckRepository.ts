import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { CanonicalDeck, CanonicalQuestion, DeckRepository } from '../application/ports'

interface DeckFile {
  exam?: {
    slug?: unknown
    deckVersion?: unknown
    domains?: unknown
    questionCount?: unknown
  }
  questions?: unknown
}

function parseQuestion(value: unknown, examSlug: string, deckVersion: string): CanonicalQuestion {
  if (!value || typeof value !== 'object') {
    throw new Error('Deck contains a non-object question.')
  }
  const question = value as Record<string, unknown>
  if (
    typeof question.id !== 'string'
    || question.examSlug !== examSlug
    || typeof question.domain !== 'string'
    || typeof question.topic !== 'string'
    || !['A', 'B', 'C'].includes(String(question.correctOption))
  ) {
    throw new Error('Deck contains an invalid canonical question.')
  }
  return {
    id: question.id,
    examSlug,
    deckVersion,
    domain: question.domain,
    topic: question.topic,
    correctOption: question.correctOption as CanonicalQuestion['correctOption'],
  }
}

export class FileDeckRepository implements DeckRepository {
  private readonly cache = new Map<string, CanonicalDeck | null>()

  constructor(private readonly directory: string) {}

  async getDeck(examSlug: string): Promise<CanonicalDeck | null> {
    if (this.cache.has(examSlug)) {
      return this.cache.get(examSlug) ?? null
    }

    let raw: string
    try {
      raw = await readFile(join(this.directory, `${examSlug}.json`), 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        this.cache.set(examSlug, null)
        return null
      }
      throw error
    }

    const parsed = JSON.parse(raw) as DeckFile
    const slug = parsed.exam?.slug
    const deckVersion = parsed.exam?.deckVersion
    const domains = parsed.exam?.domains
    if (slug !== examSlug || typeof deckVersion !== 'string' || !Array.isArray(domains) || !Array.isArray(parsed.questions)) {
      throw new Error('Deck metadata does not match its canonical file name.')
    }

    const questions = parsed.questions.map((value) => parseQuestion(value, examSlug, deckVersion))
    if (questions.length !== parsed.exam?.questionCount || new Set(questions.map(({ id }) => id)).size !== questions.length) {
      throw new Error('Deck question count or IDs are invalid.')
    }
    if (!domains.every((domain) => typeof domain === 'string')) {
      throw new Error('Deck domains are invalid.')
    }

    const deck = { examSlug, deckVersion, domains: domains as string[], questions }
    this.cache.set(examSlug, deck)
    return deck
  }
}
