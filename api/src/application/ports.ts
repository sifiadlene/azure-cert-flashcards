import type { ChallengeOptionKey, QuestionReference } from '../../../web/src/challenge/contracts'
import type { CapabilityHash, RoomEntity } from '../domain/entities'

export interface CanonicalQuestion extends QuestionReference {
  correctOption: ChallengeOptionKey
}

export interface CanonicalDeck {
  examSlug: string
  deckVersion: string
  domains: string[]
  questions: CanonicalQuestion[]
}

export interface DeckRepository {
  getDeck(examSlug: string): Promise<CanonicalDeck | null>
}

export interface RoomCommit {
  room: RoomEntity
  /** Logical room ETag used by repositories without provider-managed ETags. */
  expectedEtag: string
  /** Provider-managed ETag used for Cosmos If-Match concurrency. */
  expectedStorageEtag?: string
  insertedAnswerIds?: string[]
}

/**
 * A production Cosmos implementation must use /roomId, transactional batches within one
 * partition, If-Match on the room item, create-only deterministic answer items, and the configured
 * TTL on every item. It must translate HTTP 409/412 into the domain conflict errors.
 */
export interface RoomRepository {
  create(room: RoomEntity, createKey: string): Promise<void>
  getById(roomId: string): Promise<RoomEntity | null>
  getByCode(roomCode: string): Promise<RoomEntity | null>
  getByCreateKey(createKey: string): Promise<RoomEntity | null>
  commit(change: RoomCommit): Promise<void>
  touch(roomId: string, playerId: string, nowMs: number): Promise<void>
}

export interface Clock {
  nowMs(): number
}

export interface IdGenerator {
  roomId(): string
  roomCode(): string
  playerId(): string
  gameId(): string
}

export interface RandomSource {
  shuffled<T>(values: readonly T[]): T[]
}

export interface CapabilityTokenService {
  issue(purpose: string): { rawToken: string; stored: CapabilityHash }
  verify(rawToken: string, stored: CapabilityHash): boolean
  deriveKey(purpose: string): string
}

export interface Telemetry {
  track(name: string, properties?: Readonly<Record<string, string | number | boolean>>): void
}

export const NOOP_TELEMETRY: Telemetry = {
  track: () => undefined,
}
