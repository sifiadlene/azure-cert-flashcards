export const CHALLENGE_PROTOCOL_VERSION = 1 as const

export const CHALLENGE_PLAYER_LIMITS = {
  minimumToStart: 2,
  maximum: 10,
} as const

export const CHALLENGE_QUESTION_COUNTS = [5, 10, 20] as const
export const CHALLENGE_TIMER_SECONDS = [15, 30, 60] as const

export const CHALLENGE_SCORING = {
  correctAnswerPoints: 1_000,
  speedBucketMs: 5_000,
  speedBucketPoints: 50,
  maximumSpeedBonus: 500,
} as const

export const CHALLENGE_PRESENCE = {
  activeThroughMs: 5_000,
  reconnectingThroughMs: 15_000,
} as const


export type ChallengeQuestionCount = (typeof CHALLENGE_QUESTION_COUNTS)[number]
export type ChallengeTimerSeconds = (typeof CHALLENGE_TIMER_SECONDS)[number]
export type ChallengeOptionKey = 'A' | 'B' | 'C'
export type PresenceStatus = 'active' | 'reconnecting' | 'inactive'

export type ChallengeScope =
  | { kind: 'all' }
  | { kind: 'domain'; domain: string }

export interface ChallengeSettings {
  examSlug: string
  deckVersion: string
  scope: ChallengeScope
  questionCount: ChallengeQuestionCount
  timerSeconds: ChallengeTimerSeconds
}

export interface QuestionReference {
  id: string
  examSlug: string
  deckVersion: string
  domain: string
  topic: string
}

export interface PlayerRow {
  playerId: string
  nickname: string
  role: 'host' | 'player'
  joinOrder: number
  presence: PresenceStatus
  lastSeenAtMs: number
  hasAnswered: boolean
}

export interface LeaderboardCandidate {
  playerId: string
  nickname: string
  points: number
  correctCount: number
  cumulativeResponseTimeMs: number
  joinOrder: number
}

export interface LeaderboardRow extends LeaderboardCandidate {
  rank: number
}

export type RoundResultRow =
  | {
      playerId: string
      outcome: 'correct'
      selectedOption: ChallengeOptionKey
      responseTimeMs: number
      speedBonus: number
      pointsAwarded: number
    }
  | {
      playerId: string
      outcome: 'incorrect'
      selectedOption: ChallengeOptionKey
      responseTimeMs: number
      speedBonus: 0
      pointsAwarded: 0
    }
  | {
      playerId: string
      outcome: 'late' | 'missing'
      selectedOption: ChallengeOptionKey | null
      responseTimeMs: null
      speedBonus: 0
      pointsAwarded: 0
    }

export interface RoundReveal {
  roundIndex: number
  question: QuestionReference
  correctOption: ChallengeOptionKey
  results: RoundResultRow[]
}

export type RoomPhase =
  | { kind: 'lobby' }
  | { kind: 'countdown'; startsAtMs: number }
  | {
      kind: 'questionOpen'
      roundIndex: number
      question: QuestionReference
      openedAtMs: number
      deadlineAtMs: number
    }
  | {
      kind: 'questionReveal'
      roundIndex: number
      revealedAtMs: number
      advanceAtMs: number
      reveal: RoundReveal
    }
  | { kind: 'completed'; completedAtMs: number }
  | { kind: 'expired'; expiredAtMs: number }

export interface RoomVersionMetadata {
  roomVersion: number
  etag: string
}

export interface PollingMetadata extends RoomVersionMetadata {
  serverNowMs: number
  nextPollAfterMs: number
}

export interface RoomSnapshotBase {
  protocolVersion: typeof CHALLENGE_PROTOCOL_VERSION
  roomId: string
  roomCode: string
  gameId: string | null
  settings: ChallengeSettings
  players: PlayerRow[]
  leaderboard: LeaderboardRow[]
  roundCount: number
  polling: PollingMetadata
}

export type RoomSnapshot = RoomSnapshotBase & (
  | { phase: Extract<RoomPhase, { kind: 'lobby' | 'countdown' | 'completed' | 'expired' }> }
  | {
      phase: Extract<RoomPhase, { kind: 'questionOpen' }>
      viewerAnswer: { kind: 'notSubmitted' } | { kind: 'submitted'; selectedOption: ChallengeOptionKey }
      answeredPlayerCount: number
    }
  | { phase: Extract<RoomPhase, { kind: 'questionReveal' }> }
)

export type CapabilityContext =
  | { kind: 'host'; roomId: string; playerId: string; capabilityId: string }
  | { kind: 'player'; roomId: string; playerId: string; capabilityId: string }

export interface CommandMetadata {
  protocolVersion: typeof CHALLENGE_PROTOCOL_VERSION
  commandId: string
  idempotencyKey: string
  expectedRoomVersion: number | null
}

export type ChallengeCommand =
  | { kind: 'createRoom'; metadata: CommandMetadata; hostNickname: string; settings: ChallengeSettings }
  | { kind: 'joinRoom'; metadata: CommandMetadata; roomCode: string; nickname: string }
  | { kind: 'resumePlayer'; metadata: CommandMetadata; roomCode: string }
  | { kind: 'startGame'; metadata: CommandMetadata; roomId: string }
  | {
      kind: 'submitAnswer'
      metadata: CommandMetadata
      roomId: string
      roundIndex: number
      selectedOption: ChallengeOptionKey
    }
  | { kind: 'reconcileRound'; metadata: CommandMetadata; roomId: string; roundIndex: number }
  | { kind: 'advanceRound'; metadata: CommandMetadata; roomId: string }
  | { kind: 'kickPlayer'; metadata: CommandMetadata; roomId: string; playerId: string }
  | { kind: 'leaveRoom'; metadata: CommandMetadata; roomId: string }
  | { kind: 'endRoom'; metadata: CommandMetadata; roomId: string }
  | { kind: 'replayGame'; metadata: CommandMetadata; roomId: string }

export type ChallengeValidationIssue = {
  field: string
  code: 'required' | 'invalidFormat' | 'invalidValue' | 'outOfRange' | 'unsupported'
  message: string
}

export type ChallengeError =
  | { kind: 'validation'; issues: ChallengeValidationIssue[] }
  | { kind: 'roomNotFound'; retryable: false }
  | { kind: 'roomFull'; maximumPlayers: number; retryable: false }
  | { kind: 'nicknameUnavailable'; retryable: false }
  | { kind: 'unauthorized'; retryable: false }
  | { kind: 'forbidden'; requiredRole: 'host'; retryable: false }
  | { kind: 'phaseConflict'; phase: RoomPhase['kind']; retryable: false }
  | { kind: 'versionConflict'; currentRoomVersion: number; retryable: true }
  | { kind: 'duplicateAnswer'; roundIndex: number; retryable: false }
  | { kind: 'answerTooLate'; roundIndex: number; retryable: false }
  | { kind: 'unsupportedPool'; availableQuestionCount: number; supportedCounts: ChallengeQuestionCount[]; retryable: false }
  | { kind: 'deckVersionMismatch'; expectedDeckVersion: string; retryable: false }
  | { kind: 'roomExpired'; retryable: false }
  | { kind: 'rateLimited'; retryAfterMs: number; retryable: true }
  | { kind: 'internal'; traceId: string; retryable: true }

export type CommandResult<T> =
  | { ok: true; snapshot: RoomSnapshot; value: T; replayed: boolean }
  | { ok: false; error: ChallengeError }

export type ValidationResult<T> =
  | { valid: true; value: T }
  | { valid: false; issues: ChallengeValidationIssue[] }
