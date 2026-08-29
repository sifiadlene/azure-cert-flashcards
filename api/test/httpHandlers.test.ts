import type { HttpRequest, InvocationContext } from '@azure/functions'
import { describe, expect, it } from 'vitest'
import { InMemoryRoomRepository } from '../src/adapters/inMemoryRoomRepository'
import { PepperedCapabilityTokenService } from '../src/adapters/system'
import { ChallengeService } from '../src/application/challengeService'
import type { CanonicalDeck, Clock, IdGenerator, RandomSource } from '../src/application/ports'
import { createChallengeHandlers } from '../src/http/handlers'

const deck: CanonicalDeck = {
  examSlug: 'gh300',
  deckVersion: '2026-08-28',
  domains: ['ResponsibleAI'],
  questions: Array.from({ length: 5 }, (_, index) => ({
    id: `q-${index}`,
    examSlug: 'gh300',
    deckVersion: '2026-08-28',
    domain: 'ResponsibleAI',
    topic: 'Topic',
    correctOption: 'A',
  })),
}

function setup() {
  const clock: Clock = { nowMs: () => 10_000 }
  let player = 0
  const ids: IdGenerator = {
    roomId: () => 'room-http',
    roomCode: () => 'ABC234',
    playerId: () => `player-${++player}`,
    gameId: () => 'game-http',
  }
  const random: RandomSource = { shuffled: (values) => [...values] }
  const service = new ChallengeService(
    new InMemoryRoomRepository(),
    { getDeck: async () => deck },
    clock,
    ids,
    random,
    new PepperedCapabilityTokenService(Buffer.alloc(32, 9)),
  )
  return createChallengeHandlers(service)
}

function request(options: {
  body?: unknown
  headers?: Record<string, string>
  params?: Record<string, string>
}): HttpRequest {
  const text = options.body === undefined ? '' : JSON.stringify(options.body)
  return {
    headers: new Headers(options.headers),
    params: options.params ?? {},
    text: async () => text,
  } as unknown as HttpRequest
}

const context = {
  error: () => undefined,
} as unknown as InvocationContext

const createBody = {
  metadata: {
    protocolVersion: 1,
    commandId: 'command-create',
    idempotencyKey: 'idempotency-create',
    expectedRoomVersion: null,
  },
  hostNickname: 'Host',
  settings: {
    examSlug: 'gh300',
    deckVersion: '2026-08-28',
    scope: { kind: 'all' },
    questionCount: 5,
    timerSeconds: 15,
  },
}

describe('HTTP challenge handlers', () => {
  it('strictly rejects malformed and over-specified request bodies', async () => {
    const handlers = setup()
    const response = await handlers.createRoom(request({ body: { ...createBody, unexpected: true } }), context)
    expect(response.status).toBe(400)
    expect(response.jsonBody).toMatchObject({ error: { kind: 'validation' } })
  })

  it('returns capability only from create and emits ETag without CORS headers', async () => {
    const handlers = setup()
    const response = await handlers.createRoom(request({ body: createBody }), context)
    expect(response.status).toBe(201)
    const body = response.jsonBody as { token: string; snapshot: { roomId: string } }
    expect(body.token).toHaveLength(43)
    expect(body.snapshot.roomId).toBe('room-http')
    expect(response.headers).toMatchObject({ etag: '"room-1"' })
    expect(response.headers).not.toHaveProperty('access-control-allow-origin')
  })

  it('requires a bearer capability and always returns current snapshot metadata', async () => {
    const handlers = setup()
    const created = await handlers.createRoom(request({ body: createBody }), context)
    const body = created.jsonBody as { token: string }

    const unauthorized = await handlers.getSnapshot(request({ params: { roomId: 'room-http' } }), context)
    expect(unauthorized.status).toBe(401)

    const current = await handlers.getSnapshot(request({
      params: { roomId: 'room-http' },
      headers: {
        authorization: `Bearer ${body.token}`,
      },
    }), context)
    expect(current.status).toBe(200)
    expect(current.jsonBody).toMatchObject({ snapshot: { polling: { serverNowMs: 10_000 } } })
    expect(current.headers).toMatchObject({ etag: '"room-1"' })
  })

  it('maps stale optimistic concurrency to HTTP 412', async () => {
    const handlers = setup()
    const created = await handlers.createRoom(request({ body: createBody }), context)
    const body = created.jsonBody as { token: string }
    const join = await handlers.joinRoom(request({
      params: { roomCode: 'ABC234' },
      body: {
        metadata: { ...createBody.metadata, commandId: 'command-join', idempotencyKey: 'idempotency-join' },
        nickname: 'Guest',
      },
    }), context)
    expect(join.status).toBe(201)

    const stale = await handlers.startGame(request({
      params: { roomId: 'room-http' },
      headers: { authorization: `Bearer ${body.token}` },
      body: {
        metadata: { ...createBody.metadata, commandId: 'command-start', idempotencyKey: 'idempotency-start', expectedRoomVersion: 1 },
      },
    }), context)
    expect(stale.status).toBe(412)
    expect(stale.jsonBody).toMatchObject({ error: { kind: 'versionConflict', currentRoomVersion: 2 } })
  })
})
