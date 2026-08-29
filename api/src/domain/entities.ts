import type {
  ChallengeOptionKey,
  ChallengeSettings,
  RoomPhase,
  RoundResultRow,
} from '../../../web/src/challenge/contracts'

export interface CapabilityHash {
  salt: string
  digest: string
}

export interface PlayerEntity {
  playerId: string
  nickname: string
  nicknameKey: string
  role: 'host' | 'player'
  joinOrder: number
  joinedAtMs: number
  lastSeenAtMs: number
  capability: CapabilityHash
  previousCapability?: {
    value: CapabilityHash
    resumeIdempotencyKey: string
  }
  points: number
  correctCount: number
  cumulativeResponseTimeMs: number
}

export interface AnswerEntity {
  id: string
  roomId: string
  gameId: string
  roundIndex: number
  playerId: string
  selectedOption: ChallengeOptionKey
  receivedAtMs: number
  outcome: 'correct' | 'incorrect'
  responseTimeMs: number
  speedBonus: number
  pointsAwarded: number
  ttl: number
}

export interface CommandReceipt {
  operation: string
  actorPlayerId: string | null
  resultingVersion: number
}

export interface RoomEntity {
  id: string
  roomId: string
  roomCode: string
  createKey: string
  ttl: number
  version: number
  etag: string
  /** Cosmos system ETag used only for repository concurrency, never HTTP caching. */
  storageEtag?: string
  createdAtMs: number
  lastActivityAtMs: number
  settings: ChallengeSettings
  gameId: string | null
  phase: RoomPhase
  questionOrder: string[]
  players: PlayerEntity[]
  answers: Record<string, AnswerEntity>
  roundResults: Record<number, RoundResultRow[]>
  commandReceipts: Record<string, CommandReceipt>
}

export function answerId(roundIndex: number, playerId: string): string {
  return `answer:${roundIndex}:${playerId}`
}
