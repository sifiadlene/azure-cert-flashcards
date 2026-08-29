import { describe, expect, it, vi } from 'vitest'
import type { ChallengeCapability, SnapshotResponse } from './apiClient'
import { ChallengePollingController } from './polling'

const capability: ChallengeCapability = { roomId: 'r', roomCode: 'ABC234', playerId: 'p', role: 'player', token: 'token' }

describe('ChallengePollingController', () => {
  it('polls immediately and honors the lobby interval', async () => {
    const callbacks: Array<() => void> = []
    const delays: number[] = []
    const result: SnapshotResponse = {
      snapshot: {
        protocolVersion: 1, roomId: 'r', roomCode: 'ABC234', gameId: null,
        settings: { examSlug: 'gh300', deckVersion: '2026-08-28', scope: { kind: 'all' }, questionCount: 5, timerSeconds: 15 },
        players: [], leaderboard: [], roundCount: 0, phase: { kind: 'lobby' },
        polling: { roomVersion: 1, etag: '"room-1"', serverNowMs: 0, nextPollAfterMs: 2_000 },
      },
      etag: '"room-1"', receivedAtMs: 0,
    }
    const fetchSnapshot = vi.fn().mockResolvedValue(result)
    const controller = new ChallengePollingController(capability, { onResult: vi.fn(), onError: vi.fn() }, {
      fetchSnapshot,
      setTimer: ((callback: () => void, delay = 0) => { callbacks.push(callback); delays.push(delay); return callbacks.length }) as typeof window.setTimeout,
      clearTimer: vi.fn() as unknown as typeof window.clearTimeout,
      random: () => 0.5,
      now: () => 0,
      isHidden: () => false,
    })

    controller.start()
    expect(delays).toEqual([0])
    callbacks.shift()?.()
    await vi.waitFor(() => expect(fetchSnapshot).toHaveBeenCalledOnce())
    await vi.waitFor(() => expect(delays).toEqual([0, 2_000]))
    controller.stop()
  })

  it('coalesces refreshNow during an in-flight fetch without starting concurrent loops', async () => {
    const callbacks: Array<() => void> = []
    const delays: number[] = []
    let resolveFirst: ((value: SnapshotResponse) => void) | undefined
    const result: SnapshotResponse = {
      snapshot: {
        protocolVersion: 1, roomId: 'r', roomCode: 'ABC234', gameId: null,
        settings: { examSlug: 'gh300', deckVersion: '2026-08-28', scope: { kind: 'all' }, questionCount: 5, timerSeconds: 15 },
        players: [], leaderboard: [], roundCount: 0, phase: { kind: 'lobby' },
        polling: { roomVersion: 1, etag: '"room-1"', serverNowMs: 0, nextPollAfterMs: 2_000 },
      },
      etag: '"room-1"', receivedAtMs: 0,
    }
    const fetchSnapshot = vi.fn()
      .mockImplementationOnce(() => new Promise<SnapshotResponse>((resolve) => { resolveFirst = resolve }))
      .mockResolvedValue(result)
    const controller = new ChallengePollingController(capability, { onResult: vi.fn(), onError: vi.fn() }, {
      fetchSnapshot,
      setTimer: ((callback: () => void, delay = 0) => { callbacks.push(callback); delays.push(delay); return callbacks.length }) as typeof window.setTimeout,
      clearTimer: vi.fn() as unknown as typeof window.clearTimeout,
      random: () => 0.5,
      now: () => 0,
      isHidden: () => false,
    })

    controller.start()
    callbacks.shift()?.()
    await vi.waitFor(() => expect(fetchSnapshot).toHaveBeenCalledOnce())
    controller.refreshNow()
    controller.refreshNow()
    expect(fetchSnapshot).toHaveBeenCalledOnce()
    resolveFirst?.(result)
    await vi.waitFor(() => expect(delays).toEqual([0, 0]))
    callbacks.shift()?.()
    await vi.waitFor(() => expect(fetchSnapshot).toHaveBeenCalledTimes(2))
    await vi.waitFor(() => expect(delays).toEqual([0, 0, 2_000]))
    controller.stop()
  })

  it('applies bounded exponential backoff with jitter after errors', async () => {
    const callbacks: Array<() => void> = []
    const delays: number[] = []
    const controller = new ChallengePollingController(capability, { onResult: vi.fn(), onError: vi.fn() }, {
      fetchSnapshot: vi.fn().mockRejectedValue(new Error('offline')),
      setTimer: ((callback: () => void, delay = 0) => { callbacks.push(callback); delays.push(delay); return callbacks.length }) as typeof window.setTimeout,
      clearTimer: vi.fn() as unknown as typeof window.clearTimeout,
      random: () => 0.5,
      now: () => 0,
    })
    controller.start()
    callbacks.shift()?.()
    await vi.waitFor(() => expect(delays).toEqual([0, 1_000]))
    callbacks.shift()?.()
    await vi.waitFor(() => expect(delays).toEqual([0, 1_000, 2_000]))
    controller.stop()
  })
})
