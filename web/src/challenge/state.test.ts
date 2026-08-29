import { describe, expect, it } from 'vitest'
import type { RoomSnapshot } from './contracts'
import { challengeReducer, commandsAreSafe, initialChallengeState } from './state'

function snapshot(version: number, phase: RoomSnapshot['phase'] = { kind: 'lobby' }): RoomSnapshot {
  return {
    protocolVersion: 1,
    roomId: 'room', roomCode: 'ABC234', gameId: null,
    settings: { examSlug: 'gh300', deckVersion: '2026-08-28', scope: { kind: 'all' }, questionCount: 5, timerSeconds: 15 },
    players: [], leaderboard: [], roundCount: 0, phase,
    polling: { roomVersion: version, etag: `"room-${version}"`, serverNowMs: 1000, nextPollAfterMs: 2000 },
  } as RoomSnapshot
}

describe('challenge reducer', () => {
  it('preserves the last snapshot while reconnecting and disables commands', () => {
    const connected = challengeReducer(initialChallengeState, {
      type: 'snapshot', snapshot: snapshot(2), clock: { offsetMs: 5, synchronized: true },
    })
    const reconnecting = challengeReducer(connected, {
      type: 'pollFailed', error: { kind: 'internal', traceId: 'network', retryable: true },
    })

    expect(reconnecting.snapshot?.polling.roomVersion).toBe(2)
    expect(reconnecting.connection).toBe('reconnecting')
    expect(commandsAreSafe(reconnecting)).toBe(false)
  })

  it('ignores stale snapshots and clears a local choice on round changes', () => {
    const current = challengeReducer({ ...initialChallengeState, selectedOption: 'B' }, {
      type: 'snapshot', snapshot: snapshot(3), clock: { offsetMs: 0, synchronized: true },
    })
    expect(challengeReducer(current, {
      type: 'snapshot', snapshot: snapshot(2), clock: { offsetMs: 1, synchronized: true },
    }).snapshot?.polling.roomVersion).toBe(3)
  })
})
