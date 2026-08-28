import { describe, expect, it } from 'vitest'
import {
  summarizeChallengePools,
  validateDeckParity,
} from './validateFlashcardData.mjs'

function createDeck() {
  const questions = Array.from({ length: 20 }, (_, index) => ({
    id: `exam-2026-08-28-${index + 1}`,
    examSlug: 'exam',
    domain: index < 7 ? 'SmallDomain' : 'LargeDomain',
    topic: index < 7 ? 'SmallTopic' : 'LargeTopic',
    tags: ['EXAM', index < 7 ? 'SmallDomain' : 'LargeDomain'],
    options: [{ key: 'A' }, { key: 'B' }, { key: 'C' }],
    correctOption: 'A',
  }))

  return {
    exam: {
      slug: 'exam',
      code: 'EXAM-100',
      sourceFile: 'exam_flashcards_2026-08-28.csv',
      deckVersion: '2026-08-28',
      updatedOn: '2026-08-28',
      questionCount: questions.length,
      domains: ['SmallDomain', 'LargeDomain'],
      topics: ['SmallTopic', 'LargeTopic'],
    },
    questions,
  }
}

describe('generated deck parity', () => {
  it('accepts translated text changes when canonical structure is unchanged', () => {
    const english = createDeck()
    const french = structuredClone(english)
    french.questions[0].promptHtml = 'Texte traduit'

    expect(validateDeckParity(english, french, 'exam')).toEqual([])
  })

  it.each([
    ['ID', (deck: ReturnType<typeof createDeck>) => { deck.questions[0].id = 'different' }],
    ['option keys', (deck: ReturnType<typeof createDeck>) => { deck.questions[0].options.reverse() }],
    ['correct option', (deck: ReturnType<typeof createDeck>) => { deck.questions[0].correctOption = 'B' }],
    ['domain', (deck: ReturnType<typeof createDeck>) => { deck.questions[0].domain = 'Other' }],
    ['topic', (deck: ReturnType<typeof createDeck>) => { deck.questions[0].topic = 'Other' }],
    ['tags', (deck: ReturnType<typeof createDeck>) => { deck.questions[0].tags = ['OTHER'] }],
    ['exam slug', (deck: ReturnType<typeof createDeck>) => { deck.exam.slug = 'other' }],
    ['exam code', (deck: ReturnType<typeof createDeck>) => { deck.exam.code = 'OTHER-100' }],
    ['source file', (deck: ReturnType<typeof createDeck>) => { deck.exam.sourceFile = 'other.csv' }],
    ['deck version', (deck: ReturnType<typeof createDeck>) => { deck.exam.deckVersion = '2026-08-29' }],
    ['updated date', (deck: ReturnType<typeof createDeck>) => { deck.exam.updatedOn = '2026-08-29' }],
    ['question count', (deck: ReturnType<typeof createDeck>) => { deck.exam.questionCount = 19 }],
    ['domains', (deck: ReturnType<typeof createDeck>) => { deck.exam.domains.reverse() }],
    ['topics', (deck: ReturnType<typeof createDeck>) => { deck.exam.topics.reverse() }],
  ])('rejects mismatched %s', (_label, mutate) => {
    const english = createDeck()
    const french = structuredClone(english)
    mutate(french)

    expect(validateDeckParity(english, french, 'exam')).not.toEqual([])
  })
})

describe('challenge pool support', () => {
  it('reports only supported counts without rejecting small domains', () => {
    expect(summarizeChallengePools(createDeck())).toEqual([
      { scope: 'all', availableQuestionCount: 20, supportedCounts: [5, 10, 20] },
      { scope: 'LargeDomain', availableQuestionCount: 13, supportedCounts: [5, 10] },
      { scope: 'SmallDomain', availableQuestionCount: 7, supportedCounts: [5] },
    ])
  })
})
