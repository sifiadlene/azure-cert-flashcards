import type { HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { randomUUID } from 'node:crypto'
import type { ZodType } from 'zod'
import type { ChallengeError } from '../../../web/src/challenge/contracts'
import type { ChallengeService } from '../application/challengeService'
import { ChallengeApplicationError } from '../domain/errors'
import {
  answerSchema,
  commandSchema,
  createRoomSchema,
  joinRoomSchema,
  reconcileSchema,
} from './schemas'

const MAX_BODY_BYTES = 16_384

type Handler = (request: HttpRequest, context: InvocationContext) => Promise<HttpResponseInit>

function bearerToken(request: HttpRequest): string {
  const value = request.headers.get('authorization')
  const match = /^Bearer ([A-Za-z0-9_-]{22,})$/.exec(value ?? '')
  if (!match) {
    throw new ChallengeApplicationError({ kind: 'unauthorized', retryable: false })
  }
  return match[1]
}

async function parseBody<T>(request: HttpRequest, schema: ZodType<T>): Promise<T> {
  const declaredLength = Number(request.headers.get('content-length') ?? '0')
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    throw new ChallengeApplicationError({
      kind: 'validation',
      issues: [{ field: 'body', code: 'outOfRange', message: 'Request body is too large.' }],
    })
  }
  const text = await request.text()
  if (Buffer.byteLength(text, 'utf8') > MAX_BODY_BYTES) {
    throw new ChallengeApplicationError({
      kind: 'validation',
      issues: [{ field: 'body', code: 'outOfRange', message: 'Request body is too large.' }],
    })
  }
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    throw new ChallengeApplicationError({
      kind: 'validation',
      issues: [{ field: 'body', code: 'invalidFormat', message: 'Request body must be valid JSON.' }],
    })
  }
  const parsed = schema.safeParse(value)
  if (!parsed.success) {
    throw new ChallengeApplicationError({
      kind: 'validation',
      issues: parsed.error.issues.map((issue) => ({
        field: issue.path.join('.') || 'body',
        code: 'invalidValue',
        message: issue.message,
      })),
    })
  }
  return parsed.data
}

function statusFor(error: ChallengeError): number {
  switch (error.kind) {
    case 'validation': return 400
    case 'unauthorized': return 401
    case 'forbidden': return 403
    case 'roomNotFound': return 404
    case 'roomExpired': return 410
    case 'rateLimited': return 429
    case 'internal': return 500
    case 'versionConflict': return 412
    default: return 409
  }
}

function success(body: unknown, etag: string, status = 200): HttpResponseInit {
  return {
    status,
    headers: {
      'cache-control': 'no-store',
      'content-type': 'application/json; charset=utf-8',
      etag,
    },
    jsonBody: body,
  }
}

function wrap(operation: (request: HttpRequest) => Promise<HttpResponseInit>): Handler {
  return async (request, context) => {
    try {
      return await operation(request)
    } catch (error) {
      const traceId = randomUUID()
      if (error instanceof ChallengeApplicationError) {
        return {
          status: statusFor(error.detail),
          headers: { 'cache-control': 'no-store', 'content-type': 'application/json; charset=utf-8' },
          jsonBody: { error: error.detail },
        }
      }
      context.error('Challenge request failed.', { traceId })
      return {
        status: 500,
        headers: { 'cache-control': 'no-store', 'content-type': 'application/json; charset=utf-8' },
        jsonBody: { error: { kind: 'internal', traceId, retryable: true } },
      }
    }
  }
}

export function createChallengeHandlers(service: ChallengeService) {
  const createRoom = wrap(async (request) => {
    const body = await parseBody(request, createRoomSchema)
    const result = await service.createRoom(body)
    return success(result, result.snapshot.polling.etag, result.replayed ? 200 : 201)
  })

  const joinRoom = wrap(async (request) => {
    const body = await parseBody(request, joinRoomSchema)
    const result = await service.joinRoom({ ...body, roomCode: request.params.roomCode })
    return success(result, result.snapshot.polling.etag, result.replayed ? 200 : 201)
  })

  const resumePlayer = wrap(async (request) => {
    const body = await parseBody(request, commandSchema)
    const result = await service.resumePlayer(request.params.roomCode, body.metadata, bearerToken(request))
    return success(result, result.snapshot.polling.etag)
  })

  const getSnapshot = wrap(async (request) => {
    const snapshot = await service.getSnapshot(request.params.roomId, bearerToken(request))
    return success({ snapshot }, snapshot.polling.etag)
  })

  const startGame = wrap(async (request) => {
    const body = await parseBody(request, commandSchema)
    const result = await service.startGame(request.params.roomId, body.metadata, bearerToken(request))
    return success(result, result.snapshot.polling.etag)
  })

  const submitAnswer = wrap(async (request) => {
    const body = await parseBody(request, answerSchema)
    const result = await service.submitAnswer({ ...body, roomId: request.params.roomId }, bearerToken(request))
    return success(result, result.snapshot.polling.etag)
  })

  const reconcileRound = wrap(async (request) => {
    const body = await parseBody(request, reconcileSchema)
    const result = await service.reconcileRound(request.params.roomId, body.roundIndex, body.metadata, bearerToken(request))
    return success(result, result.snapshot.polling.etag)
  })

  const advanceRound = wrap(async (request) => {
    const body = await parseBody(request, commandSchema)
    const result = await service.advanceRound(request.params.roomId, body.metadata, bearerToken(request))
    return success(result, result.snapshot.polling.etag)
  })

  const kickPlayer = wrap(async (request) => {
    const body = await parseBody(request, commandSchema)
    const result = await service.kickPlayer(request.params.roomId, request.params.playerId, body.metadata, bearerToken(request))
    return success(result, result.snapshot.polling.etag)
  })

  const leaveRoom = wrap(async (request) => {
    const body = await parseBody(request, commandSchema)
    const result = await service.leaveRoom(request.params.roomId, body.metadata, bearerToken(request))
    return success(result, result.snapshot.polling.etag)
  })

  const endRoom = wrap(async (request) => {
    const body = await parseBody(request, commandSchema)
    const result = await service.endRoom(request.params.roomId, body.metadata, bearerToken(request))
    return success(result, result.snapshot.polling.etag)
  })

  const replayGame = wrap(async (request) => {
    const body = await parseBody(request, commandSchema)
    const result = await service.replayGame(request.params.roomId, body.metadata, bearerToken(request))
    return success(result, result.snapshot.polling.etag)
  })

  return {
    createRoom,
    joinRoom,
    resumePlayer,
    getSnapshot,
    startGame,
    submitAnswer,
    reconcileRound,
    advanceRound,
    kickPlayer,
    leaveRoom,
    endRoom,
    replayGame,
  }
}
