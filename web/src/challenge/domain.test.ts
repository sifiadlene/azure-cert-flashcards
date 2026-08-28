import { describe, expect, it } from 'vitest'
import {
  calculateScore,
  derivePresence,
  isPhaseTransitionAllowed,
  nicknameComparisonKey,
  normalizeNickname,
  rankLeaderboard,
  shouldRevealRound,
  validateChallengeSettings,
  validateNickname,
} from './domain'

const validSettings = {
  examSlug: 'gh300',
  deckVersion: '2026-08-28',
  scope: { kind: 'all' },
  questionCount: 10,
  timerSeconds: 30,
}

describe('challenge settings', () => {
  it('accepts and normalizes supported settings', () => {
    expect(validateChallengeSettings({
      ...validSettings,
      examSlug: ' GH300 ',
      scope: { kind: 'domain', domain: ' ResponsibleAI ' },
    })).toEqual({
      valid: true,
      value: {
        ...validSettings,
        scope: { kind: 'domain', domain: 'ResponsibleAI' },
      },
    })
  })

  it.each([
    ['questionCount', { ...validSettings, questionCount: 6 }],
    ['timerSeconds', { ...validSettings, timerSeconds: 20 }],
    ['deckVersion', { ...validSettings, deckVersion: 'v1' }],
    ['scope.domain', { ...validSettings, scope: { kind: 'domain', domain: '  ' } }],
  ])('rejects invalid %s', (field, settings) => {
    const result = validateChallengeSettings(settings)
    expect(result.valid).toBe(false)
    if (!result.valid) {
      expect(result.issues.some((entry) => entry.field === field)).toBe(true)
    }
  })
})

describe('nicknames', () => {
  it('normalizes Unicode compatibility forms and whitespace', () => {
    expect(normalizeNickname('  Ａlice\t Smith  ')).toBe('Alice Smith')
    expect(nicknameComparisonKey('ÉLODIE')).toBe(nicknameComparisonKey('élodie'))
  })

  it('accepts the inclusive 2-to-24 code-point boundaries', () => {
    expect(validateNickname('Al')).toEqual({ valid: true, value: 'Al' })
    expect(validateNickname('😀'.repeat(24)).valid).toBe(true)
  })

  it.each(['A', 'a'.repeat(25), `Al\u200Bice`, 42])('rejects invalid nickname %j', (nickname) => {
    expect(validateNickname(nickname).valid).toBe(false)
  })
})

describe('coarse speed scoring', () => {
  it('awards one five-second bucket immediately before the deadline', () => {
    expect(calculateScore({
      correct: true,
      openedAtMs: 0,
      deadlineAtMs: 30_000,
      receivedAtMs: 29_999,
    })).toEqual({ outcome: 'correct', responseTimeMs: 29_999, speedBonus: 50, points: 1_050 })
  })

  it('moves to the next bucket only above a five-second boundary', () => {
    expect(calculateScore({ correct: true, openedAtMs: 0, deadlineAtMs: 30_000, receivedAtMs: 25_000 }).speedBonus).toBe(50)
    expect(calculateScore({ correct: true, openedAtMs: 0, deadlineAtMs: 30_000, receivedAtMs: 24_999 }).speedBonus).toBe(100)
  })

  it('caps the bonus and gives incorrect or late answers zero points', () => {
    expect(calculateScore({ correct: true, openedAtMs: 0, deadlineAtMs: 60_000, receivedAtMs: 0 }).speedBonus).toBe(500)
    expect(calculateScore({ correct: false, openedAtMs: 0, deadlineAtMs: 30_000, receivedAtMs: 1_000 }).points).toBe(0)
    expect(calculateScore({ correct: true, openedAtMs: 0, deadlineAtMs: 30_000, receivedAtMs: 30_000 }).outcome).toBe('late')
  })
})

describe('leaderboard ranking', () => {
  it('uses points, correct count, response time, then join order', () => {
    const ranked = rankLeaderboard([
      { playerId: 'slow', nickname: 'Slow', points: 2_000, correctCount: 2, cumulativeResponseTimeMs: 15_000, joinOrder: 1 },
      { playerId: 'fewer', nickname: 'Fewer', points: 2_000, correctCount: 1, cumulativeResponseTimeMs: 1_000, joinOrder: 2 },
      { playerId: 'fast-late', nickname: 'Fast late', points: 2_000, correctCount: 2, cumulativeResponseTimeMs: 10_000, joinOrder: 4 },
      { playerId: 'fast-early', nickname: 'Fast early', points: 2_000, correctCount: 2, cumulativeResponseTimeMs: 10_000, joinOrder: 3 },
    ])

    expect(ranked.map(({ playerId }) => playerId)).toEqual(['fast-early', 'fast-late', 'slow', 'fewer'])
    expect(ranked.map(({ rank }) => rank)).toEqual([1, 2, 3, 4])
  })

  it('assigns competition ranks to exact ties without mutating input', () => {
    const candidates = [
      { playerId: 'b', nickname: 'B', points: 1_000, correctCount: 1, cumulativeResponseTimeMs: 2_000, joinOrder: 1 },
      { playerId: 'a', nickname: 'A', points: 1_000, correctCount: 1, cumulativeResponseTimeMs: 2_000, joinOrder: 1 },
      { playerId: 'c', nickname: 'C', points: 0, correctCount: 0, cumulativeResponseTimeMs: 0, joinOrder: 3 },
    ]

    expect(rankLeaderboard(candidates).map(({ playerId, rank }) => [playerId, rank])).toEqual([
      ['a', 1],
      ['b', 1],
      ['c', 3],
    ])
    expect(candidates[0].playerId).toBe('b')
  })
})

describe('room timing semantics', () => {
  it('allows only declared phase transitions', () => {
    expect(isPhaseTransitionAllowed('lobby', 'countdown')).toBe(true)
    expect(isPhaseTransitionAllowed('questionReveal', 'questionOpen')).toBe(true)
    expect(isPhaseTransitionAllowed('questionReveal', 'completed')).toBe(true)
    expect(isPhaseTransitionAllowed('questionOpen', 'completed')).toBe(false)
    expect(isPhaseTransitionAllowed('expired', 'lobby')).toBe(false)
  })

  it('reveals when all active members answer or the deadline is reached', () => {
    expect(shouldRevealRound({ memberPlayerIds: ['a', 'b'], answeredPlayerIds: ['b', 'a'], deadlineAtMs: 10_000, nowMs: 9_999 })).toBe(true)
    expect(shouldRevealRound({ memberPlayerIds: ['a', 'b'], answeredPlayerIds: ['a'], deadlineAtMs: 10_000, nowMs: 9_999 })).toBe(false)
    expect(shouldRevealRound({ memberPlayerIds: ['a', 'b'], answeredPlayerIds: [], deadlineAtMs: 10_000, nowMs: 10_000 })).toBe(true)
    expect(shouldRevealRound({ memberPlayerIds: [], answeredPlayerIds: [], deadlineAtMs: 10_000, nowMs: 9_999 })).toBe(false)
  })

  it('derives presence at inclusive thresholds using injected time', () => {
    expect(derivePresence(5_000, 10_000)).toBe('active')
    expect(derivePresence(4_999, 10_000)).toBe('reconnecting')
    expect(derivePresence(-5_000, 10_000)).toBe('reconnecting')
    expect(derivePresence(-5_001, 10_000)).toBe('inactive')
    expect(derivePresence(11_000, 10_000)).toBe('active')
  })
})
