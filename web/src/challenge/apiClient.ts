import {
  CHALLENGE_PROTOCOL_VERSION,
  type ChallengeError,
  type ChallengeOptionKey,
  type ChallengeSettings,
  type CommandMetadata,
  type RoomSnapshot,
} from './contracts'

export interface ChallengeCapability {
  roomId: string
  roomCode: string
  playerId: string
  role: 'host' | 'player'
  token: string
}

export interface TokenCommandResponse {
  snapshot: RoomSnapshot
  token: string
  playerId: string
  replayed: boolean
}

export interface SnapshotResponse {
  snapshot: RoomSnapshot
  etag: string | null
  receivedAtMs: number
}

export class ChallengeApiError extends Error {
  readonly detail: ChallengeError
  readonly status: number

  constructor(detail: ChallengeError, status: number) {
    super(detail.kind)
    this.name = 'ChallengeApiError'
    this.detail = detail
    this.status = status
  }
}

function commandMetadata(expectedRoomVersion: number | null): CommandMetadata {
  const commandId = typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `cmd-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`
  return {
    protocolVersion: CHALLENGE_PROTOCOL_VERSION,
    commandId,
    idempotencyKey: commandId,
    expectedRoomVersion,
  }
}

function normalizeBaseUrl(value: string): string {
  return value.replace(/\/$/, '')
}

async function parseResponse<T>(response: Response): Promise<T> {
  const body = await response.json() as T | { error: ChallengeError }
  if (!response.ok) {
    const detail = 'error' in (body as object)
      ? (body as { error: ChallengeError }).error
      : { kind: 'internal', traceId: 'invalid-response', retryable: true } as const
    throw new ChallengeApiError(detail, response.status)
  }
  return body as T
}

export class ChallengeApiClient {
  private readonly baseUrl: string
  private readonly fetcher: typeof fetch
  private readonly now: () => number

  constructor(
    baseUrl = import.meta.env.VITE_PUBLIC_API_BASE ?? '/api',
    fetcher: typeof fetch = globalThis.fetch.bind(globalThis),
    now: () => number = Date.now,
  ) {
    this.baseUrl = normalizeBaseUrl(baseUrl)
    this.fetcher = fetcher
    this.now = now
  }

  async createRoom(hostNickname: string, settings: ChallengeSettings): Promise<TokenCommandResponse> {
    return this.post('/rooms', { metadata: commandMetadata(null), hostNickname, settings })
  }

  async joinRoom(roomCode: string, nickname: string): Promise<TokenCommandResponse> {
    return this.post(`/rooms/${encodeURIComponent(roomCode)}/join`, {
      metadata: commandMetadata(null),
      nickname,
    })
  }

  async getSnapshot(capability: ChallengeCapability): Promise<SnapshotResponse> {
    const response = await this.fetcher(`${this.baseUrl}/rooms/${encodeURIComponent(capability.roomId)}`, {
      headers: {
        authorization: `Bearer ${capability.token}`,
      },
      cache: 'no-store',
    })
    const receivedAtMs = this.now()
    const body = await parseResponse<{ snapshot: RoomSnapshot }>(response)
    return { snapshot: body.snapshot, etag: response.headers.get('etag'), receivedAtMs }
  }

  start(capability: ChallengeCapability, version: number) {
    return this.command(capability, 'start', version)
  }

  submitAnswer(
    capability: ChallengeCapability,
    version: number,
    roundIndex: number,
    selectedOption: ChallengeOptionKey,
  ) {
    return this.command(capability, 'answers', version, { roundIndex, selectedOption })
  }

  reconcile(capability: ChallengeCapability, version: number, roundIndex: number) {
    return this.command(capability, 'reconcile', version, { roundIndex })
  }

  advance(capability: ChallengeCapability, version: number) {
    return this.command(capability, 'advance', version)
  }

  kick(capability: ChallengeCapability, version: number, playerId: string) {
    return this.command(capability, `players/${encodeURIComponent(playerId)}/kick`, version)
  }

  leave(capability: ChallengeCapability, version: number) {
    return this.command(capability, 'leave', version)
  }

  replay(capability: ChallengeCapability, version: number) {
    return this.command(capability, 'replay', version)
  }

  private async command(
    capability: ChallengeCapability,
    route: string,
    expectedRoomVersion: number,
    extra: Record<string, unknown> = {},
  ): Promise<{ snapshot: RoomSnapshot; replayed: boolean }> {
    return this.post(
      `/rooms/${encodeURIComponent(capability.roomId)}/${route}`,
      { metadata: commandMetadata(expectedRoomVersion), ...extra },
      capability.token,
    )
  }

  private async post<T>(path: string, body: unknown, token?: string): Promise<T> {
    const response = await this.fetcher(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
    })
    return parseResponse<T>(response)
  }
}
