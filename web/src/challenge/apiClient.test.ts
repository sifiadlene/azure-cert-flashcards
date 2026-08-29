import { describe, expect, it, vi } from 'vitest'
import { ChallengeApiClient, ChallengeApiError, type ChallengeCapability } from './apiClient'

const capability: ChallengeCapability = {
  roomId: 'room/one', roomCode: 'ABC234', playerId: 'p1', role: 'host', token: 'secret-token',
}

function response(status: number, body?: unknown, etag = '"room-2"') {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', etag },
  })
}

describe('ChallengeApiClient', () => {
  it('uses bearer auth and always requests a fresh snapshot', async () => {
    const snapshot = { roomId: 'room/one' }
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response(200, { snapshot }))
    const client = new ChallengeApiClient('/api/', fetcher, () => 42)

    await expect(client.getSnapshot(capability)).resolves.toEqual({
      snapshot, etag: '"room-2"', receivedAtMs: 42,
    })
    expect(fetcher).toHaveBeenCalledWith('/api/rooms/room%2Fone', expect.objectContaining({
      headers: { authorization: 'Bearer secret-token' },
      cache: 'no-store',
    }))
  })

  it('surfaces typed challenge errors', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response(404, {
      error: { kind: 'roomNotFound', retryable: false },
    }))
    const client = new ChallengeApiClient('/api', fetcher)

    const error = await client.joinRoom('BAD234', 'Alice').catch((value: unknown) => value)
    expect(error).toBeInstanceOf(ChallengeApiError)
    expect((error as ChallengeApiError).detail.kind).toBe('roomNotFound')
  })
})
