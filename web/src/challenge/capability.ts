import type { ChallengeCapability } from './apiClient'

const STORAGE_KEY = 'certification-flashcards-challenge-capability-v1'

function isCapability(value: unknown): value is ChallengeCapability {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Record<string, unknown>
  return typeof candidate.roomId === 'string'
    && typeof candidate.roomCode === 'string'
    && typeof candidate.playerId === 'string'
    && (candidate.role === 'host' || candidate.role === 'player')
    && typeof candidate.token === 'string'
}

export function readChallengeCapability(storage: Storage = window.sessionStorage): ChallengeCapability | null {
  const raw = storage.getItem(STORAGE_KEY)
  if (!raw) return null
  try {
    const value: unknown = JSON.parse(raw)
    if (isCapability(value)) return value
  } catch {
    // Invalid or stale browser data is cleared below.
  }
  storage.removeItem(STORAGE_KEY)
  return null
}

export function writeChallengeCapability(
  capability: ChallengeCapability,
  storage: Storage = window.sessionStorage,
): void {
  storage.setItem(STORAGE_KEY, JSON.stringify(capability))
}

export function clearChallengeCapability(storage: Storage = window.sessionStorage): void {
  storage.removeItem(STORAGE_KEY)
}
