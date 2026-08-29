import {
  CHALLENGE_PLAYER_LIMITS,
  CHALLENGE_PROTOCOL_VERSION,
  CHALLENGE_QUESTION_COUNTS,
  type ChallengeError,
  type ChallengeOptionKey,
  type ChallengeSettings,
  type CommandMetadata,
  type RoomSnapshot,
  type RoundResultRow,
} from '../../../web/src/challenge/contracts'
import {
  calculateScore,
  derivePresence,
  nicknameComparisonKey,
  rankLeaderboard,
  shouldRevealRound,
  validateChallengeSettings,
  validateNickname,
} from '../../../web/src/challenge/domain'
import { answerId, type PlayerEntity, type RoomEntity } from '../domain/entities'
import {
  ChallengeApplicationError,
  DuplicateAnswerStorageError,
  DuplicateRoomError,
  RepositoryConflictError,
} from '../domain/errors'
import {
  NOOP_TELEMETRY,
  type CapabilityTokenService,
  type Clock,
  type DeckRepository,
  type IdGenerator,
  type RandomSource,
  type RoomRepository,
  type Telemetry,
} from './ports'

const MAX_CREATE_ATTEMPTS = 8
const MAX_CONCURRENCY_ATTEMPTS = 3
const ACTIVE_POLL_MS = 1_000
const LOBBY_POLL_MS = 2_000
const DEFAULT_RETENTION_SECONDS = 86_400
const PRESENCE_TOUCH_INTERVAL_MS = 5_000

export interface ChallengeServiceOptions {
  retentionSeconds?: number
}

export interface AuthenticatedResponse {
  snapshot: RoomSnapshot
  replayed: boolean
}

export interface TokenResponse extends AuthenticatedResponse {
  token: string
  playerId: string
}

export interface CreateRoomInput {
  metadata: CommandMetadata
  hostNickname: unknown
  settings: unknown
}

export interface JoinRoomInput {
  metadata: CommandMetadata
  roomCode: string
  nickname: unknown
}

export interface SubmitAnswerInput {
  metadata: CommandMetadata
  roomId: string
  roundIndex: number
  selectedOption: ChallengeOptionKey
}

type MutationValue = Record<string, never> | { playerId: string }

type Mutation = (
  room: RoomEntity,
  actor: PlayerEntity,
  nowMs: number,
) => Promise<{ value: MutationValue; insertedAnswerIds?: string[]; noChange?: boolean }>
  | { value: MutationValue; insertedAnswerIds?: string[]; noChange?: boolean }

function fail(detail: ChallengeError): never {
  throw new ChallengeApplicationError(detail)
}

function logicalEtag(version: number): string {
  return `"room-${version}"`
}

function receiptKey(metadata: CommandMetadata): string {
  return metadata.idempotencyKey
}

function normalizeRoomCode(value: string): string {
  return value.trim().toUpperCase()
}

export class ChallengeService {
  constructor(
    private readonly rooms: RoomRepository,
    private readonly decks: DeckRepository,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
    private readonly random: RandomSource,
    private readonly tokens: CapabilityTokenService,
    private readonly telemetry: Telemetry = NOOP_TELEMETRY,
    options: ChallengeServiceOptions = {},
  ) {
    this.retentionSeconds = options.retentionSeconds ?? DEFAULT_RETENTION_SECONDS
    if (!Number.isInteger(this.retentionSeconds) || this.retentionSeconds < 300 || this.retentionSeconds > 2_147_483_647) {
      throw new Error('CHALLENGE_RETENTION_SECONDS must be an integer between 300 and 2147483647.')
    }
  }

  private readonly retentionSeconds: number

  async createRoom(input: CreateRoomInput): Promise<TokenResponse> {
    const nickname = this.requireNickname(input.hostNickname)
    const settings = this.requireSettings(input.settings)
    await this.requirePool(settings)
    const createKey = this.tokens.deriveKey(`create:${input.metadata.idempotencyKey}`)
    const prior = await this.rooms.getByCreateKey(createKey)
    const priorReceipt = prior?.commandReceipts[receiptKey(input.metadata)]
    if (prior && priorReceipt?.operation === 'createRoom' && priorReceipt.actorPlayerId) {
      const issued = this.tokens.issue(`create:${prior.roomId}:${priorReceipt.actorPlayerId}:${input.metadata.idempotencyKey}`)
      return {
        snapshot: this.snapshot(prior, priorReceipt.actorPlayerId, this.clock.nowMs()),
        token: issued.rawToken,
        playerId: priorReceipt.actorPlayerId,
        replayed: true,
      }
    }

    for (let attempt = 0; attempt < MAX_CREATE_ATTEMPTS; attempt += 1) {
      const nowMs = this.clock.nowMs()
      const roomId = this.ids.roomId()
      const roomCode = normalizeRoomCode(this.ids.roomCode())
      const playerId = this.ids.playerId()
      const issued = this.tokens.issue(`create:${roomId}:${playerId}:${input.metadata.idempotencyKey}`)
      const room: RoomEntity = {
        id: 'room',
        roomId,
        roomCode,
        createKey,
        ttl: this.retentionSeconds,
        version: 1,
        etag: logicalEtag(1),
        createdAtMs: nowMs,
        lastActivityAtMs: nowMs,
        settings,
        gameId: null,
        phase: { kind: 'lobby' },
        questionOrder: [],
        players: [this.newPlayer(playerId, nickname, 'host', 1, issued.stored, nowMs)],
        answers: {},
        roundResults: {},
        commandReceipts: {
          [receiptKey(input.metadata)]: {
            operation: 'createRoom',
            actorPlayerId: playerId,
            resultingVersion: 1,
          },
        },
      }

      try {
        await this.rooms.create(room, createKey)
        this.telemetry.track('challenge.room.created')
        return { snapshot: this.snapshot(room, playerId, nowMs), token: issued.rawToken, playerId, replayed: false }
      } catch (error) {
        if (!(error instanceof DuplicateRoomError)) {
          throw error
        }
        const existing = await this.rooms.getByCreateKey(createKey) ?? await this.rooms.getById(roomId)
        const receipt = existing?.commandReceipts[receiptKey(input.metadata)]
        if (existing && receipt?.operation === 'createRoom' && receipt.actorPlayerId) {
          const replayToken = this.tokens.issue(`create:${existing.roomId}:${receipt.actorPlayerId}:${input.metadata.idempotencyKey}`)
          return {
            snapshot: this.snapshot(existing, receipt.actorPlayerId, nowMs),
            token: replayToken.rawToken,
            playerId: receipt.actorPlayerId,
            replayed: true,
          }
        }
      }
    }

    fail({ kind: 'internal', traceId: 'room-code-collision', retryable: true })
  }

  async joinRoom(input: JoinRoomInput): Promise<TokenResponse> {
    const nickname = this.requireNickname(input.nickname)
    const room = await this.requireRoomByCode(input.roomCode)
    const key = receiptKey(input.metadata)
    const prior = room.commandReceipts[key]
    if (prior?.operation === 'joinRoom' && prior.actorPlayerId) {
      const issued = this.tokens.issue(`join:${room.roomId}:${prior.actorPlayerId}:${key}`)
      return {
        snapshot: this.snapshot(room, prior.actorPlayerId, this.clock.nowMs()),
        token: issued.rawToken,
        playerId: prior.actorPlayerId,
        replayed: true,
      }
    }

    if (room.phase.kind !== 'lobby') {
      fail({ kind: 'phaseConflict', phase: room.phase.kind, retryable: false })
    }
    if (room.players.length >= CHALLENGE_PLAYER_LIMITS.maximum) {
      fail({ kind: 'roomFull', maximumPlayers: CHALLENGE_PLAYER_LIMITS.maximum, retryable: false })
    }
    if (room.players.some((player) => player.nicknameKey === nicknameComparisonKey(nickname))) {
      fail({ kind: 'nicknameUnavailable', retryable: false })
    }

    const playerId = this.ids.playerId()
    const issued = this.tokens.issue(`join:${room.roomId}:${playerId}:${key}`)
    const result = await this.mutate(room.roomId, input.metadata, 'joinRoom', null, (draft, _actor, nowMs) => {
      if (draft.phase.kind !== 'lobby') {
        fail({ kind: 'phaseConflict', phase: draft.phase.kind, retryable: false })
      }
      if (draft.players.length >= CHALLENGE_PLAYER_LIMITS.maximum) {
        fail({ kind: 'roomFull', maximumPlayers: CHALLENGE_PLAYER_LIMITS.maximum, retryable: false })
      }
      if (draft.players.some((player) => player.nicknameKey === nicknameComparisonKey(nickname))) {
        fail({ kind: 'nicknameUnavailable', retryable: false })
      }
      draft.players.push(this.newPlayer(playerId, nickname, 'player', draft.players.length + 1, issued.stored, nowMs))
      return { value: { playerId } }
    }, playerId)

    return { ...result, token: issued.rawToken, playerId }
  }

  async resumePlayer(roomCode: string, metadata: CommandMetadata, rawToken: string): Promise<TokenResponse> {
    const room = await this.requireRoomByCode(roomCode)
    const key = receiptKey(metadata)
    const actor = this.authenticate(room, rawToken, key)
    const issued = this.tokens.issue(`resume:${room.roomId}:${actor.playerId}:${key}`)
    const receipt = room.commandReceipts[key]
    if (receipt?.operation === 'resumePlayer' && receipt.actorPlayerId === actor.playerId) {
      return {
        snapshot: this.snapshot(room, actor.playerId, this.clock.nowMs()),
        token: issued.rawToken,
        playerId: actor.playerId,
        replayed: true,
      }
    }

    const result = await this.mutate(room.roomId, metadata, 'resumePlayer', rawToken, (_draft, current, nowMs) => {
      current.previousCapability = { value: current.capability, resumeIdempotencyKey: key }
      current.capability = issued.stored
      current.lastSeenAtMs = nowMs
      return { value: { playerId: current.playerId } }
    })
    return { ...result, token: issued.rawToken, playerId: actor.playerId }
  }

  async getSnapshot(roomId: string, rawToken: string): Promise<RoomSnapshot> {
    const room = await this.requireRoom(roomId)
    const actor = this.authenticate(room, rawToken)
    const nowMs = this.clock.nowMs()
    const shouldTouch = nowMs - actor.lastSeenAtMs >= PRESENCE_TOUCH_INTERVAL_MS
    actor.lastSeenAtMs = nowMs
    room.lastActivityAtMs = nowMs
    if (shouldTouch) {
      try {
        await this.rooms.touch(room.roomId, actor.playerId, nowMs)
      } catch {
        this.telemetry.track('challenge.presence.touch.failed')
      }
    }
    return this.snapshot(room, actor.playerId, nowMs)
  }

  async startGame(roomId: string, metadata: CommandMetadata, rawToken: string): Promise<AuthenticatedResponse> {
    return this.mutate(roomId, metadata, 'startGame', rawToken, async (room, actor, nowMs) => {
      this.requireHost(actor)
      if (room.phase.kind !== 'lobby') {
        fail({ kind: 'phaseConflict', phase: room.phase.kind, retryable: false })
      }
      if (room.players.length < CHALLENGE_PLAYER_LIMITS.minimumToStart) {
        fail({ kind: 'phaseConflict', phase: room.phase.kind, retryable: false })
      }
      await this.openGame(room, nowMs)
      return { value: {} }
    })
  }

  async submitAnswer(input: SubmitAnswerInput, rawToken: string): Promise<AuthenticatedResponse> {
    return this.mutate(input.roomId, input.metadata, 'submitAnswer', rawToken, async (room, actor, nowMs) => {
      if (room.phase.kind !== 'questionOpen' || room.phase.roundIndex !== input.roundIndex) {
        fail({ kind: 'phaseConflict', phase: room.phase.kind, retryable: false })
      }
      const id = answerId(input.roundIndex, actor.playerId)
      if (room.answers[id]) {
        fail({ kind: 'duplicateAnswer', roundIndex: input.roundIndex, retryable: false })
      }
      if (nowMs >= room.phase.deadlineAtMs) {
        fail({ kind: 'answerTooLate', roundIndex: input.roundIndex, retryable: false })
      }
      const question = await this.findQuestionInRoom(room, room.phase.question.id)
      const score = calculateScore({
        correct: question.correctOption === input.selectedOption,
        openedAtMs: room.phase.openedAtMs,
        deadlineAtMs: room.phase.deadlineAtMs,
        receivedAtMs: nowMs,
      })
      if (score.outcome === 'late') {
        fail({ kind: 'answerTooLate', roundIndex: input.roundIndex, retryable: false })
      }
      room.answers[id] = {
        id,
        roomId: room.roomId,
        gameId: room.gameId ?? '',
        roundIndex: input.roundIndex,
        playerId: actor.playerId,
        selectedOption: input.selectedOption,
        receivedAtMs: nowMs,
        outcome: score.outcome,
        responseTimeMs: score.responseTimeMs,
        speedBonus: score.speedBonus,
        pointsAwarded: score.points,
        ttl: this.retentionSeconds,
      }
      const answered = this.answersForRound(room, input.roundIndex).map(({ playerId }) => playerId)
      if (shouldRevealRound({
        memberPlayerIds: room.players.map(({ playerId }) => playerId),
        answeredPlayerIds: answered,
        deadlineAtMs: room.phase.deadlineAtMs,
        nowMs,
      })) {
        this.reveal(room, nowMs, question.correctOption)
      }
      return { value: {}, insertedAnswerIds: [id] }
    })
  }

  async reconcileRound(roomId: string, roundIndex: number, metadata: CommandMetadata, rawToken: string): Promise<AuthenticatedResponse> {
    return this.mutate(roomId, metadata, 'reconcileRound', rawToken, async (room, _actor, nowMs) => {
      if (room.phase.kind === 'questionReveal' && room.phase.roundIndex === roundIndex) {
        return { value: {}, noChange: true }
      }
      if (room.phase.kind !== 'questionOpen' || room.phase.roundIndex !== roundIndex) {
        fail({ kind: 'phaseConflict', phase: room.phase.kind, retryable: false })
      }
      if (nowMs < room.phase.deadlineAtMs) {
        fail({ kind: 'phaseConflict', phase: room.phase.kind, retryable: false })
      }
      const question = await this.findQuestionInRoom(room, room.phase.question.id)
      this.reveal(room, nowMs, question.correctOption)
      return { value: {} }
    })
  }

  async advanceRound(roomId: string, metadata: CommandMetadata, rawToken: string): Promise<AuthenticatedResponse> {
    return this.mutate(roomId, metadata, 'advanceRound', rawToken, async (room, actor, nowMs) => {
      this.requireHost(actor)
      if (room.phase.kind !== 'questionReveal') {
        fail({ kind: 'phaseConflict', phase: room.phase.kind, retryable: false })
      }
      const nextIndex = room.phase.roundIndex + 1
      if (nextIndex >= room.questionOrder.length) {
        room.phase = { kind: 'completed', completedAtMs: nowMs }
      } else {
        room.phase = await this.openRound(room, nextIndex, nowMs)
      }
      return { value: {} }
    })
  }

  async kickPlayer(roomId: string, playerId: string, metadata: CommandMetadata, rawToken: string): Promise<AuthenticatedResponse> {
    return this.mutate(roomId, metadata, 'kickPlayer', rawToken, (room, actor) => {
      this.requireHost(actor)
      if (room.phase.kind !== 'lobby' && room.phase.kind !== 'questionReveal') {
        fail({ kind: 'phaseConflict', phase: room.phase.kind, retryable: false })
      }
      const target = room.players.find((player) => player.playerId === playerId)
      if (!target || target.role === 'host') {
        fail({ kind: 'forbidden', requiredRole: 'host', retryable: false })
      }
      room.players = room.players.filter((player) => player.playerId !== playerId)
      return { value: {} }
    })
  }

  async leaveRoom(roomId: string, metadata: CommandMetadata, rawToken: string): Promise<AuthenticatedResponse> {
    return this.mutate(roomId, metadata, 'leaveRoom', rawToken, (room, actor, nowMs) => {
      if (room.phase.kind !== 'lobby' && room.phase.kind !== 'questionReveal' && room.phase.kind !== 'completed') {
        fail({ kind: 'phaseConflict', phase: room.phase.kind, retryable: false })
      }
      if (actor.role === 'host') {
        room.phase = { kind: 'expired', expiredAtMs: nowMs }
      } else {
        room.players = room.players.filter((player) => player.playerId !== actor.playerId)
      }
      return { value: {} }
    })
  }

  async endRoom(roomId: string, metadata: CommandMetadata, rawToken: string): Promise<AuthenticatedResponse> {
    return this.mutate(roomId, metadata, 'endRoom', rawToken, (room, actor, nowMs) => {
      this.requireHost(actor)
      room.phase = { kind: 'expired', expiredAtMs: nowMs }
      return { value: {} }
    })
  }

  async replayGame(roomId: string, metadata: CommandMetadata, rawToken: string): Promise<AuthenticatedResponse> {
    return this.mutate(roomId, metadata, 'replayGame', rawToken, async (room, actor, nowMs) => {
      this.requireHost(actor)
      if (room.phase.kind !== 'completed') {
        fail({ kind: 'phaseConflict', phase: room.phase.kind, retryable: false })
      }
      for (const player of room.players) {
        player.points = 0
        player.correctCount = 0
        player.cumulativeResponseTimeMs = 0
      }
      room.answers = {}
      room.roundResults = {}
      await this.openGame(room, nowMs)
      return { value: {} }
    })
  }

  private async mutate(
    roomId: string,
    metadata: CommandMetadata,
    operation: string,
    rawToken: string | null,
    mutation: Mutation,
    unauthenticatedActorId?: string,
  ): Promise<AuthenticatedResponse> {
    for (let attempt = 0; attempt < MAX_CONCURRENCY_ATTEMPTS; attempt += 1) {
      const current = await this.requireRoom(roomId)
      const actor = unauthenticatedActorId
        ? ({ playerId: unauthenticatedActorId } as PlayerEntity)
        : this.authenticate(current, rawToken ?? '', operation === 'resumePlayer' ? metadata.idempotencyKey : undefined)
      const receipt = current.commandReceipts[receiptKey(metadata)]
      if (receipt) {
        if (receipt.operation !== operation || receipt.actorPlayerId !== actor.playerId) {
          fail({ kind: 'versionConflict', currentRoomVersion: current.version, retryable: true })
        }
        return { snapshot: this.snapshot(current, actor.playerId, this.clock.nowMs()), replayed: true }
      }
      if (metadata.expectedRoomVersion !== null && metadata.expectedRoomVersion !== current.version) {
        fail({ kind: 'versionConflict', currentRoomVersion: current.version, retryable: true })
      }

      const draft = structuredClone(current)
      const draftActor = unauthenticatedActorId
        ? ({ playerId: unauthenticatedActorId } as PlayerEntity)
        : this.authenticate(draft, rawToken ?? '', operation === 'resumePlayer' ? metadata.idempotencyKey : undefined)
      const nowMs = this.clock.nowMs()
      const changed = await mutation(draft, draftActor, nowMs)
      if (changed.noChange) {
        return { snapshot: this.snapshot(current, actor.playerId, nowMs), replayed: true }
      }
      draft.version = current.version + 1
      draft.etag = logicalEtag(draft.version)
      draft.lastActivityAtMs = nowMs
      draft.commandReceipts[receiptKey(metadata)] = {
        operation,
        actorPlayerId: actor.playerId,
        resultingVersion: draft.version,
      }

      try {
        await this.rooms.commit({
          room: draft,
          expectedEtag: current.etag,
          expectedStorageEtag: current.storageEtag,
          insertedAnswerIds: changed.insertedAnswerIds,
        })
        return { snapshot: this.snapshot(draft, actor.playerId, nowMs), replayed: false }
      } catch (error) {
        if (error instanceof DuplicateAnswerStorageError) {
          fail({ kind: 'duplicateAnswer', roundIndex: draft.phase.kind === 'questionOpen' ? draft.phase.roundIndex : 0, retryable: false })
        }
        if (!(error instanceof RepositoryConflictError)) {
          throw error
        }
        this.telemetry.track('challenge.concurrency.retry', { operation, attempt: attempt + 1 })
      }
    }

    const current = await this.requireRoom(roomId)
    fail({ kind: 'versionConflict', currentRoomVersion: current.version, retryable: true })
  }

  private async requirePool(settings: ChallengeSettings): Promise<void> {
    const deck = await this.decks.getDeck(settings.examSlug)
    if (!deck) {
      fail({ kind: 'unsupportedPool', availableQuestionCount: 0, supportedCounts: [], retryable: false })
    }
    if (deck.deckVersion !== settings.deckVersion) {
      fail({ kind: 'deckVersionMismatch', expectedDeckVersion: deck.deckVersion, retryable: false })
    }
    if (settings.scope.kind === 'domain' && !deck.domains.includes(settings.scope.domain)) {
      fail({ kind: 'unsupportedPool', availableQuestionCount: 0, supportedCounts: [], retryable: false })
    }
    const available = deck.questions.filter((question) =>
      settings.scope.kind === 'all' || question.domain === settings.scope.domain).length
    if (available < settings.questionCount) {
      fail({
        kind: 'unsupportedPool',
        availableQuestionCount: available,
        supportedCounts: CHALLENGE_QUESTION_COUNTS.filter((count) => count <= available),
        retryable: false,
      })
    }
  }

  private async openGame(room: RoomEntity, nowMs: number): Promise<void> {
    const deck = await this.decks.getDeck(room.settings.examSlug)
    if (!deck || deck.deckVersion !== room.settings.deckVersion) {
      fail({ kind: 'deckVersionMismatch', expectedDeckVersion: deck?.deckVersion ?? 'unavailable', retryable: false })
    }
    const pool = deck.questions.filter((question) =>
      room.settings.scope.kind === 'all' || question.domain === room.settings.scope.domain)
    room.gameId = this.ids.gameId()
    room.questionOrder = this.random.shuffled(pool.map(({ id }) => id)).slice(0, room.settings.questionCount)
    room.answers = {}
    room.roundResults = {}
    room.phase = await this.openRound(room, 0, nowMs)
  }

  private async openRound(room: RoomEntity, roundIndex: number, nowMs: number): Promise<Extract<RoomEntity['phase'], { kind: 'questionOpen' }>> {
    const question = await this.findQuestionInRoom(room, room.questionOrder[roundIndex])
    return {
      kind: 'questionOpen',
      roundIndex,
      question: {
        id: question.id,
        examSlug: question.examSlug,
        deckVersion: question.deckVersion,
        domain: question.domain,
        topic: question.topic,
      },
      openedAtMs: nowMs,
      deadlineAtMs: nowMs + room.settings.timerSeconds * 1_000,
    }
  }

  private reveal(room: RoomEntity, nowMs: number, correctOption: ChallengeOptionKey): void {
    if (room.phase.kind !== 'questionOpen') {
      return
    }
    const phase = room.phase
    const roundAnswers = this.answersForRound(room, phase.roundIndex)
    const results: RoundResultRow[] = room.players.map((player) => {
      const answer = roundAnswers.find((candidate) => candidate.playerId === player.playerId)
      if (!answer) {
        return {
          playerId: player.playerId,
          outcome: 'missing',
          selectedOption: null,
          responseTimeMs: null,
          speedBonus: 0,
          pointsAwarded: 0,
        }
      }
      player.points += answer.pointsAwarded
      player.correctCount += answer.outcome === 'correct' ? 1 : 0
      player.cumulativeResponseTimeMs += answer.responseTimeMs
      if (answer.outcome === 'correct') {
        return {
          playerId: player.playerId,
          outcome: 'correct',
          selectedOption: answer.selectedOption,
          responseTimeMs: answer.responseTimeMs,
          speedBonus: answer.speedBonus,
          pointsAwarded: answer.pointsAwarded,
        }
      }
      return {
        playerId: player.playerId,
        outcome: 'incorrect',
        selectedOption: answer.selectedOption,
        responseTimeMs: answer.responseTimeMs,
        speedBonus: 0,
        pointsAwarded: 0,
      }
    })
    room.roundResults[phase.roundIndex] = results
    room.phase = {
      kind: 'questionReveal',
      roundIndex: phase.roundIndex,
      revealedAtMs: nowMs,
      advanceAtMs: nowMs + 5_000,
      reveal: {
        roundIndex: phase.roundIndex,
        question: phase.question,
        correctOption,
        results,
      },
    }
  }

  private snapshot(room: RoomEntity, viewerId: string, nowMs: number): RoomSnapshot {
    const phase = room.phase
    const roundIndex = phase.kind === 'questionOpen' || phase.kind === 'questionReveal' ? phase.roundIndex : -1
    const answer = roundIndex >= 0 ? room.answers[answerId(roundIndex, viewerId)] : undefined
    const base = {
      protocolVersion: CHALLENGE_PROTOCOL_VERSION,
      roomId: room.roomId,
      roomCode: room.roomCode,
      gameId: room.gameId,
      settings: room.settings,
      players: room.players.map((player) => ({
        playerId: player.playerId,
        nickname: player.nickname,
        role: player.role,
        joinOrder: player.joinOrder,
        presence: derivePresence(player.lastSeenAtMs, nowMs),
        lastSeenAtMs: player.lastSeenAtMs,
        hasAnswered: roundIndex >= 0 && Boolean(room.answers[answerId(roundIndex, player.playerId)]),
      })),
      leaderboard: rankLeaderboard(room.players.map((player) => ({
        playerId: player.playerId,
        nickname: player.nickname,
        points: player.points,
        correctCount: player.correctCount,
        cumulativeResponseTimeMs: player.cumulativeResponseTimeMs,
        joinOrder: player.joinOrder,
      }))),
      roundCount: room.questionOrder.length,
      polling: {
        roomVersion: room.version,
        etag: room.etag,
        serverNowMs: nowMs,
        nextPollAfterMs: phase.kind === 'lobby' ? LOBBY_POLL_MS : ACTIVE_POLL_MS,
      },
    }

    if (phase.kind === 'questionOpen') {
      return {
        ...base,
        phase,
        viewerAnswer: answer
          ? { kind: 'submitted', selectedOption: answer.selectedOption }
          : { kind: 'notSubmitted' },
        answeredPlayerCount: this.answersForRound(room, phase.roundIndex).length,
      }
    }
    if (phase.kind === 'questionReveal') {
      return { ...base, phase }
    }
    return { ...base, phase }
  }

  private authenticate(room: RoomEntity, rawToken: string, resumeKey?: string): PlayerEntity {
    const player = room.players.find((candidate) =>
      this.tokens.verify(rawToken, candidate.capability)
      || (resumeKey !== undefined
        && candidate.previousCapability?.resumeIdempotencyKey === resumeKey
        && this.tokens.verify(rawToken, candidate.previousCapability.value)))
    if (!player) {
      fail({ kind: 'unauthorized', retryable: false })
    }
    return player
  }

  private async requireRoom(roomId: string): Promise<RoomEntity> {
    const room = await this.rooms.getById(roomId)
    if (!room) {
      fail({ kind: 'roomNotFound', retryable: false })
    }
    if (room.phase.kind === 'expired' || this.clock.nowMs() - room.lastActivityAtMs >= this.retentionSeconds * 1_000) {
      fail({ kind: 'roomExpired', retryable: false })
    }
    return room
  }

  private async requireRoomByCode(roomCode: string): Promise<RoomEntity> {
    const room = await this.rooms.getByCode(normalizeRoomCode(roomCode))
    if (!room) {
      fail({ kind: 'roomNotFound', retryable: false })
    }
    if (room.phase.kind === 'expired' || this.clock.nowMs() - room.lastActivityAtMs >= this.retentionSeconds * 1_000) {
      fail({ kind: 'roomExpired', retryable: false })
    }
    return room
  }

  private requireHost(player: PlayerEntity): void {
    if (player.role !== 'host') {
      fail({ kind: 'forbidden', requiredRole: 'host', retryable: false })
    }
  }

  private requireNickname(value: unknown): string {
    const result = validateNickname(value)
    if (!result.valid) {
      fail({ kind: 'validation', issues: result.issues })
    }
    return result.value
  }

  private requireSettings(value: unknown): ChallengeSettings {
    const result = validateChallengeSettings(value)
    if (!result.valid) {
      fail({ kind: 'validation', issues: result.issues })
    }
    return result.value
  }

  private newPlayer(
    playerId: string,
    nickname: string,
    role: PlayerEntity['role'],
    joinOrder: number,
    capability: PlayerEntity['capability'],
    nowMs: number,
  ): PlayerEntity {
    return {
      playerId,
      nickname,
      nicknameKey: nicknameComparisonKey(nickname),
      role,
      joinOrder,
      joinedAtMs: nowMs,
      lastSeenAtMs: nowMs,
      capability,
      points: 0,
      correctCount: 0,
      cumulativeResponseTimeMs: 0,
    }
  }

  private answersForRound(room: RoomEntity, roundIndex: number) {
    return Object.values(room.answers).filter((answer) =>
      answer.gameId === room.gameId && answer.roundIndex === roundIndex)
  }

  private async findQuestionInRoom(room: RoomEntity, questionId: string) {
    const deck = await this.decks.getDeck(room.settings.examSlug)
    const question = deck?.questions.find((candidate) => candidate.id === questionId)
    if (!question || deck?.deckVersion !== room.settings.deckVersion) {
      fail({ kind: 'deckVersionMismatch', expectedDeckVersion: deck?.deckVersion ?? 'unavailable', retryable: false })
    }
    return question
  }
}
