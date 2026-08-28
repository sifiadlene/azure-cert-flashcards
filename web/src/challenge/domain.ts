import {
  CHALLENGE_PRESENCE,
  CHALLENGE_QUESTION_COUNTS,
  CHALLENGE_SCORING,
  CHALLENGE_TIMER_SECONDS,
  type ChallengeQuestionCount,
  type ChallengeSettings,
  type ChallengeTimerSeconds,
  type ChallengeValidationIssue,
  type LeaderboardCandidate,
  type LeaderboardRow,
  type PresenceStatus,
  type RoomPhase,
  type ValidationResult,
} from './contracts'

const NICKNAME_MIN_LENGTH = 2
const NICKNAME_MAX_LENGTH = 24
const EXAM_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const DECK_VERSION_PATTERN = /^\d{4}-\d{2}-\d{2}$/
const DISALLOWED_NICKNAME_CHARACTER_PATTERN = /[\p{Cc}\p{Cf}]/u

type PhaseKind = RoomPhase['kind']

export interface ScoreInput {
  correct: boolean
  openedAtMs: number
  deadlineAtMs: number
  receivedAtMs: number
}

export type ScoreResult =
  | { outcome: 'correct'; responseTimeMs: number; speedBonus: number; points: number }
  | { outcome: 'incorrect'; responseTimeMs: number; speedBonus: 0; points: 0 }
  | { outcome: 'late'; responseTimeMs: null; speedBonus: 0; points: 0 }

export interface RoundRevealInput {
  memberPlayerIds: readonly string[]
  answeredPlayerIds: readonly string[]
  deadlineAtMs: number
  nowMs: number
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function issue(
  field: string,
  code: ChallengeValidationIssue['code'],
  message: string,
): ChallengeValidationIssue {
  return { field, code, message }
}

export function validateChallengeSettings(value: unknown): ValidationResult<ChallengeSettings> {
  if (!isRecord(value)) {
    return { valid: false, issues: [issue('settings', 'invalidValue', 'Settings must be an object.')] }
  }

  const issues: ChallengeValidationIssue[] = []
  const examSlug = typeof value.examSlug === 'string' ? value.examSlug.trim().toLowerCase() : ''
  const deckVersion = typeof value.deckVersion === 'string' ? value.deckVersion.trim() : ''

  if (!examSlug) {
    issues.push(issue('examSlug', 'required', 'An exam is required.'))
  } else if (!EXAM_SLUG_PATTERN.test(examSlug)) {
    issues.push(issue('examSlug', 'invalidFormat', 'The exam slug has an invalid format.'))
  }

  if (!deckVersion) {
    issues.push(issue('deckVersion', 'required', 'A deck version is required.'))
  } else if (!DECK_VERSION_PATTERN.test(deckVersion)) {
    issues.push(issue('deckVersion', 'invalidFormat', 'The deck version must use YYYY-MM-DD.'))
  }

  let scope: ChallengeSettings['scope'] | null = null
  if (!isRecord(value.scope) || (value.scope.kind !== 'all' && value.scope.kind !== 'domain')) {
    issues.push(issue('scope', 'invalidValue', 'Scope must select all questions or one domain.'))
  } else if (value.scope.kind === 'domain') {
    const domain = typeof value.scope.domain === 'string' ? value.scope.domain.trim() : ''
    if (!domain) {
      issues.push(issue('scope.domain', 'required', 'A domain is required for domain scope.'))
    } else {
      scope = { kind: 'domain', domain }
    }
  } else {
    scope = { kind: 'all' }
  }

  const questionCount = value.questionCount
  if (typeof questionCount !== 'number' || !CHALLENGE_QUESTION_COUNTS.includes(questionCount as ChallengeQuestionCount)) {
    issues.push(issue('questionCount', 'unsupported', 'Question count must be 5, 10, or 20.'))
  }

  const timerSeconds = value.timerSeconds
  if (typeof timerSeconds !== 'number' || !CHALLENGE_TIMER_SECONDS.includes(timerSeconds as ChallengeTimerSeconds)) {
    issues.push(issue('timerSeconds', 'unsupported', 'Timer must be 15, 30, or 60 seconds.'))
  }

  if (issues.length > 0 || scope === null) {
    return { valid: false, issues }
  }

  return {
    valid: true,
    value: {
      examSlug,
      deckVersion,
      scope,
      questionCount: questionCount as ChallengeQuestionCount,
      timerSeconds: timerSeconds as ChallengeTimerSeconds,
    },
  }
}

export function normalizeNickname(value: string): string {
  return value.normalize('NFKC').trim().replace(/\s+/gu, ' ')
}

export function validateNickname(value: unknown): ValidationResult<string> {
  if (typeof value !== 'string') {
    return { valid: false, issues: [issue('nickname', 'invalidValue', 'Nickname must be text.')] }
  }

  const normalized = normalizeNickname(value)
  const length = Array.from(normalized).length
  const issues: ChallengeValidationIssue[] = []

  if (length < NICKNAME_MIN_LENGTH || length > NICKNAME_MAX_LENGTH) {
    issues.push(issue('nickname', 'outOfRange', 'Nickname must contain between 2 and 24 characters.'))
  }
  if (DISALLOWED_NICKNAME_CHARACTER_PATTERN.test(normalized)) {
    issues.push(issue('nickname', 'invalidValue', 'Nickname contains a control or formatting character.'))
  }

  return issues.length > 0
    ? { valid: false, issues }
    : { valid: true, value: normalized }
}

export function nicknameComparisonKey(nickname: string): string {
  return normalizeNickname(nickname).toLocaleLowerCase('und')
}

export function calculateScore(input: ScoreInput): ScoreResult {
  const { correct, openedAtMs, deadlineAtMs, receivedAtMs } = input

  if (receivedAtMs >= deadlineAtMs) {
    return { outcome: 'late', responseTimeMs: null, speedBonus: 0, points: 0 }
  }

  const responseTimeMs = Math.max(0, receivedAtMs - openedAtMs)
  if (!correct) {
    return { outcome: 'incorrect', responseTimeMs, speedBonus: 0, points: 0 }
  }

  const remainingMs = Math.max(0, deadlineAtMs - receivedAtMs)
  const remainingBuckets = Math.ceil(remainingMs / CHALLENGE_SCORING.speedBucketMs)
  const speedBonus = Math.min(
    CHALLENGE_SCORING.maximumSpeedBonus,
    remainingBuckets * CHALLENGE_SCORING.speedBucketPoints,
  )

  return {
    outcome: 'correct',
    responseTimeMs,
    speedBonus,
    points: CHALLENGE_SCORING.correctAnswerPoints + speedBonus,
  }
}

function compareLeaderboardCandidates(left: LeaderboardCandidate, right: LeaderboardCandidate): number {
  return right.points - left.points
    || right.correctCount - left.correctCount
    || left.cumulativeResponseTimeMs - right.cumulativeResponseTimeMs
    || left.joinOrder - right.joinOrder
}

export function rankLeaderboard(candidates: readonly LeaderboardCandidate[]): LeaderboardRow[] {
  const sorted = [...candidates].sort((left, right) =>
    compareLeaderboardCandidates(left, right) || left.playerId.localeCompare(right.playerId),
  )
  let currentRank = 0

  return sorted.map((candidate, index) => {
    const previous = sorted[index - 1]
    if (!previous || compareLeaderboardCandidates(candidate, previous) !== 0) {
      currentRank = index + 1
    }

    return { ...candidate, rank: currentRank }
  })
}

const ALLOWED_PHASE_TRANSITIONS: Readonly<Record<PhaseKind, readonly PhaseKind[]>> = {
  lobby: ['countdown', 'expired'],
  countdown: ['questionOpen', 'expired'],
  questionOpen: ['questionReveal', 'expired'],
  questionReveal: ['questionOpen', 'completed', 'expired'],
  completed: ['expired'],
  expired: [],
}

export function isPhaseTransitionAllowed(from: PhaseKind, to: PhaseKind): boolean {
  return ALLOWED_PHASE_TRANSITIONS[from].includes(to)
}

export function shouldRevealRound(input: RoundRevealInput): boolean {
  if (input.nowMs >= input.deadlineAtMs) {
    return true
  }

  if (input.memberPlayerIds.length === 0) {
    return false
  }

  const answered = new Set(input.answeredPlayerIds)
  return input.memberPlayerIds.every((playerId) => answered.has(playerId))
}

export function derivePresence(lastSeenAtMs: number, nowMs: number): PresenceStatus {
  const elapsedMs = Math.max(0, nowMs - lastSeenAtMs)

  if (elapsedMs <= CHALLENGE_PRESENCE.activeThroughMs) {
    return 'active'
  }
  if (elapsedMs <= CHALLENGE_PRESENCE.reconnectingThroughMs) {
    return 'reconnecting'
  }
  return 'inactive'
}
