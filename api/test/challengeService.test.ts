import { describe, expect, it } from 'vitest'
import type {
  ChallengeOptionKey,
  ChallengeSettings,
  CommandMetadata,
  RoomSnapshot,
} from '../../web/src/challenge/contracts'
import { InMemoryRoomRepository } from '../src/adapters/inMemoryRoomRepository'
import { PepperedCapabilityTokenService } from '../src/adapters/system'
import { ChallengeService } from '../src/application/challengeService'
import type {
  CanonicalDeck,
  Clock,
  DeckRepository,
  IdGenerator,
  RandomSource,
} from '../src/application/ports'
import { ChallengeApplicationError } from '../src/domain/errors'

class TestClock implements Clock {
  constructor(public value = 1_000_000) {}
  nowMs(): number { return this.value }
  advance(ms: number): void { this.value += ms }
}

class TestIds implements IdGenerator {
  private room = 0
  private code = 0
  private player = 0
  private game = 0
  roomId(): string { this.room += 1; return `room-${this.room.toString().padStart(4, '0')}` }
  roomCode(): string {
    const codes = ['ABC234', 'BCD345', 'CDF456', 'DFG567', 'FGH678', 'GHJ789', 'HJK892', 'JKM923']
    const value = codes[this.code % codes.length]
    this.code += 1
    return value
  }
  playerId(): string { this.player += 1; return `player-${this.player}` }
  gameId(): string { this.game += 1; return `game-${this.game}` }
}

const questions = Array.from({ length: 8 }, (_, index) => ({
  id: `q-${index + 1}`,
  examSlug: 'gh300',
  deckVersion: '2026-08-28',
  domain: index < 6 ? 'ResponsibleAI' : 'Other',
  topic: 'Topic',
  correctOption: (['A', 'B', 'C'] as ChallengeOptionKey[])[index % 3],
}))

const deck: CanonicalDeck = {
  examSlug: 'gh300',
  deckVersion: '2026-08-28',
  domains: ['ResponsibleAI', 'Other'],
  questions,
}

const settings: ChallengeSettings = {
  examSlug: 'gh300',
  deckVersion: '2026-08-28',
  scope: { kind: 'domain', domain: 'ResponsibleAI' },
  questionCount: 5,
  timerSeconds: 15,
}

function metadata(id: string, expectedRoomVersion: number | null): CommandMetadata {
  return {
    protocolVersion: 1,
    commandId: `command-${id}`,
    idempotencyKey: `idempotency-${id}`,
    expectedRoomVersion,
  }
}

function harness(customDeck: CanonicalDeck | null = deck) {
  const rooms = new InMemoryRoomRepository()
  const clock = new TestClock()
  const deckRepository: DeckRepository = { getDeck: async () => customDeck }
  const random: RandomSource = { shuffled: (values) => [...values].reverse() }
  const service = new ChallengeService(
    rooms,
    deckRepository,
    clock,
    new TestIds(),
    random,
    new PepperedCapabilityTokenService(Buffer.alloc(32, 7)),
  )
  return { service, rooms, clock }
}

async function createAndJoin() {
  const context = harness()
  const host = await context.service.createRoom({ metadata: metadata('create', null), hostNickname: 'Host', settings })
  const guest = await context.service.joinRoom({ metadata: metadata('join', null), roomCode: 'abc234', nickname: 'Guest' })
  return { ...context, host, guest }
}

async function startTwoPlayerGame() {
  const context = await createAndJoin()
  const started = await context.service.startGame(
    context.host.snapshot.roomId,
    metadata('start', context.guest.snapshot.polling.roomVersion),
    context.host.token,
  )
  return { ...context, started }
}

async function expectErrorKind(action: Promise<unknown>, kind: string) {
  try {
    await action
    throw new Error('Expected action to fail.')
  } catch (error) {
    expect(error).toBeInstanceOf(ChallengeApplicationError)
    expect((error as ChallengeApplicationError).detail.kind).toBe(kind)
  }
}

function openPhase(snapshot: RoomSnapshot) {
  expect(snapshot.phase.kind).toBe('questionOpen')
  if (snapshot.phase.kind !== 'questionOpen') throw new Error('Expected an open question.')
  return snapshot.phase
}

describe('room lifecycle and authorization', () => {
  it('creates, joins, normalizes nicknames, and stores 24-hour TTL entities', async () => {
    const { rooms, host, guest } = await createAndJoin()
    expect(host.snapshot.players.map(({ nickname }) => nickname)).toEqual(['Host'])
    expect(guest.snapshot.players.map(({ nickname }) => nickname)).toEqual(['Host', 'Guest'])
    expect(host.token).toMatch(/^[A-Za-z0-9_-]{43}$/)
    const stored = await rooms.getById(host.snapshot.roomId)
    expect(stored?.ttl).toBe(86_400)
    expect(stored?.players[0].capability.digest).not.toContain(host.token)
  })

  it('rejects duplicate normalized nicknames and rooms over ten members', async () => {
    const { service } = await createAndJoin()
    await expectErrorKind(service.joinRoom({ metadata: metadata('duplicate-name', null), roomCode: 'ABC234', nickname: '  GUEST ' }), 'nicknameUnavailable')
    for (let index = 3; index <= 10; index += 1) {
      await service.joinRoom({ metadata: metadata(`join-${index}`, null), roomCode: 'ABC234', nickname: `Player ${index}` })
    }
    await expectErrorKind(service.joinRoom({ metadata: metadata('join-11', null), roomCode: 'ABC234', nickname: 'Player 11' }), 'roomFull')
  })

  it('enforces host-only start and a minimum of two members', async () => {
    const single = harness()
    const host = await single.service.createRoom({ metadata: metadata('create', null), hostNickname: 'Host', settings })
    await expectErrorKind(single.service.startGame(host.snapshot.roomId, metadata('start', 1), host.token), 'phaseConflict')

    const joined = await createAndJoin()
    await expectErrorKind(joined.service.startGame(joined.host.snapshot.roomId, metadata('start', 2), joined.guest.token), 'forbidden')
  })

  it('rejects stale versions and retries transient repository conflicts', async () => {
    const { service, rooms, host, guest } = await createAndJoin()
    await expectErrorKind(service.startGame(host.snapshot.roomId, metadata('stale', 1), host.token), 'versionConflict')
    rooms.forceConflicts(2)
    const result = await service.startGame(host.snapshot.roomId, metadata('retry', guest.snapshot.polling.roomVersion), host.token)
    expect(result.snapshot.phase.kind).toBe('questionOpen')
  })

  it('replays state-changing commands by idempotency key without a second mutation', async () => {
    const { service, host, guest } = await createAndJoin()
    const command = metadata('start-replay', guest.snapshot.polling.roomVersion)
    const first = await service.startGame(host.snapshot.roomId, command, host.token)
    const second = await service.startGame(host.snapshot.roomId, command, host.token)
    expect(second.replayed).toBe(true)
    expect(second.snapshot.polling.roomVersion).toBe(first.snapshot.polling.roomVersion)
  })

  it('replays create requests with the same room and a usable capability token', async () => {
    const { service, rooms } = harness()
    const input = { metadata: metadata('create-retry', null), hostNickname: 'Host', settings }
    const first = await service.createRoom(input)
    const second = await service.createRoom(input)

    expect(second.replayed).toBe(true)
    expect(second.snapshot.roomId).toBe(first.snapshot.roomId)
    expect(second.snapshot.roomCode).toBe(first.snapshot.roomCode)
    expect(second.playerId).toBe(first.playerId)
    expect(second.token).toBe(first.token)
    await expect(service.getSnapshot(second.snapshot.roomId, second.token)).resolves.toBeTruthy()
    expect((await rooms.getByCode(first.snapshot.roomCode))?.roomId).toBe(first.snapshot.roomId)
  })

  it('coalesces concurrent identical creates despite independently generated room IDs', async () => {
    const { service } = harness()
    const input = { metadata: metadata('create-concurrent', null), hostNickname: 'Host', settings }
    const [first, second] = await Promise.all([service.createRoom(input), service.createRoom(input)])

    expect(second.snapshot.roomId).toBe(first.snapshot.roomId)
    expect(second.snapshot.roomCode).toBe(first.snapshot.roomCode)
    expect(second.token).toBe(first.token)
    expect([first.replayed, second.replayed].sort()).toEqual([false, true])
  })

  it('keeps snapshot reads available when a presence touch fails', async () => {
    const context = harness()
    const host = await context.service.createRoom({ metadata: metadata('create-touch', null), hostNickname: 'Host', settings })
    context.clock.advance(5_000)
    context.rooms.touch = async () => { throw new Error('transient touch failure') }

    await expect(context.service.getSnapshot(host.snapshot.roomId, host.token)).resolves.toMatchObject({
      players: [{ playerId: host.playerId, presence: 'active' }],
    })
  })

  it('rotates resume tokens, invalidates normal use of the old token, and replays a lost response', async () => {
    const { service, host, guest } = await createAndJoin()
    const command = metadata('resume', guest.snapshot.polling.roomVersion)
    const resumed = await service.resumePlayer(host.snapshot.roomCode, command, host.token)
    expect(resumed.token).not.toBe(host.token)
    await expectErrorKind(service.getSnapshot(host.snapshot.roomId, host.token), 'unauthorized')
    const replay = await service.resumePlayer(host.snapshot.roomCode, command, host.token)
    expect(replay.replayed).toBe(true)
    expect(replay.token).toBe(resumed.token)
    await expect(service.getSnapshot(host.snapshot.roomId, resumed.token)).resolves.toBeTruthy()
  })

  it('expires a room after 24 hours of inactivity', async () => {
    const { service, clock } = harness()
    const host = await service.createRoom({ metadata: metadata('create', null), hostNickname: 'Host', settings })
    clock.advance(86_400_000)
    await expectErrorKind(service.getSnapshot(host.snapshot.roomId, host.token), 'roomExpired')
  })

  it('applies configured retention to entities and expiry checks', async () => {
    const rooms = new InMemoryRoomRepository()
    const clock = new TestClock()
    const service = new ChallengeService(
      rooms,
      { getDeck: async () => deck },
      clock,
      new TestIds(),
      { shuffled: (values) => [...values] },
      new PepperedCapabilityTokenService(Buffer.alloc(32, 7)),
      undefined,
      { retentionSeconds: 600 },
    )
    const host = await service.createRoom({ metadata: metadata('retention', null), hostNickname: 'Host', settings })
    expect((await rooms.getById(host.snapshot.roomId))?.ttl).toBe(600)
    clock.advance(600_000)
    await expectErrorKind(service.getSnapshot(host.snapshot.roomId, host.token), 'roomExpired')
  })

  it('rejects stale decks and insufficient canonical pools', async () => {
    const stale = harness({ ...deck, deckVersion: '2026-08-27' })
    await expectErrorKind(stale.service.createRoom({ metadata: metadata('create', null), hostNickname: 'Host', settings }), 'deckVersionMismatch')
    const small = harness({ ...deck, questions: deck.questions.slice(0, 4) })
    await expectErrorKind(small.service.createRoom({ metadata: metadata('create', null), hostNickname: 'Host', settings }), 'unsupportedPool')
  })

  it('supports safe kick and leave transitions and explicit host end', async () => {
    const { service, host, guest } = await createAndJoin()
    const kicked = await service.kickPlayer(host.snapshot.roomId, guest.playerId, metadata('kick', 2), host.token)
    expect(kicked.snapshot.players.map(({ playerId }) => playerId)).toEqual([host.playerId])
    const replacement = await service.joinRoom({ metadata: metadata('replacement', null), roomCode: host.snapshot.roomCode, nickname: 'Replacement' })
    const left = await service.leaveRoom(host.snapshot.roomId, metadata('leave', replacement.snapshot.polling.roomVersion), replacement.token)
    expect(left.snapshot.players.map(({ playerId }) => playerId)).toEqual([host.playerId])
    const ended = await service.endRoom(host.snapshot.roomId, metadata('end', left.snapshot.polling.roomVersion), host.token)
    expect(ended.snapshot.phase.kind).toBe('expired')
  })
})

describe('authoritative rounds', () => {
  it('selects and persists a canonical server-owned question order', async () => {
    const { started, rooms } = await startTwoPlayerGame()
    expect(openPhase(started.snapshot).question.id).toBe('q-6')
    const stored = await rooms.getById(started.snapshot.roomId)
    expect(stored?.questionOrder).toEqual(['q-6', 'q-5', 'q-4', 'q-3', 'q-2'])
  })

  it('keeps answer keys and score changes redacted while a question is open', async () => {
    const { service, clock, host, started } = await startTwoPlayerGame()
    const phase = openPhase(started.snapshot)
    clock.advance(1_000)
    const submitted = await service.submitAnswer({
      metadata: metadata('host-answer', started.snapshot.polling.roomVersion),
      roomId: started.snapshot.roomId,
      roundIndex: phase.roundIndex,
      selectedOption: 'C',
    }, host.token)
    expect(submitted.snapshot.phase.kind).toBe('questionOpen')
    expect(submitted.snapshot.leaderboard.every(({ points }) => points === 0)).toBe(true)
    expect(JSON.stringify(submitted.snapshot)).not.toContain('correctOption')
  })

  it('scores on server time and reveals exactly when all members answer', async () => {
    const { service, clock, host, guest, started } = await startTwoPlayerGame()
    const phase = openPhase(started.snapshot)
    clock.advance(1_000)
    const hostAnswer = await service.submitAnswer({
      metadata: metadata('host-answer', started.snapshot.polling.roomVersion), roomId: started.snapshot.roomId,
      roundIndex: 0, selectedOption: 'C',
    }, host.token)
    clock.advance(5_000)
    const reveal = await service.submitAnswer({
      metadata: metadata('guest-answer', hostAnswer.snapshot.polling.roomVersion), roomId: started.snapshot.roomId,
      roundIndex: 0, selectedOption: 'A',
    }, guest.token)
    expect(reveal.snapshot.phase.kind).toBe('questionReveal')
    if (reveal.snapshot.phase.kind !== 'questionReveal') throw new Error('Expected reveal.')
    expect(reveal.snapshot.phase.reveal.correctOption).toBe('C')
    expect(reveal.snapshot.phase.reveal.results.map(({ outcome }) => outcome)).toEqual(['correct', 'incorrect'])
    expect(reveal.snapshot.leaderboard[0]).toMatchObject({ playerId: host.playerId, points: 1_150, correctCount: 1 })
    expect(phase.deadlineAtMs).toBe(started.snapshot.polling.serverNowMs + 15_000)
  })

  it('rejects duplicate answers and answers received at the deadline', async () => {
    const duplicate = await startTwoPlayerGame()
    const phase = openPhase(duplicate.started.snapshot)
    const first = await duplicate.service.submitAnswer({
      metadata: metadata('first', duplicate.started.snapshot.polling.roomVersion), roomId: duplicate.started.snapshot.roomId,
      roundIndex: phase.roundIndex, selectedOption: 'C',
    }, duplicate.host.token)
    await expectErrorKind(duplicate.service.submitAnswer({
      metadata: metadata('duplicate', first.snapshot.polling.roomVersion), roomId: duplicate.started.snapshot.roomId,
      roundIndex: phase.roundIndex, selectedOption: 'C',
    }, duplicate.host.token), 'duplicateAnswer')

    const late = await startTwoPlayerGame()
    const latePhase = openPhase(late.started.snapshot)
    late.clock.value = latePhase.deadlineAtMs
    await expectErrorKind(late.service.submitAnswer({
      metadata: metadata('late', late.started.snapshot.polling.roomVersion), roomId: late.started.snapshot.roomId,
      roundIndex: latePhase.roundIndex, selectedOption: 'C',
    }, late.host.token), 'answerTooLate')
  })

  it('reconciles deadlines idempotently with missing results', async () => {
    const { service, clock, host, started } = await startTwoPlayerGame()
    const phase = openPhase(started.snapshot)
    clock.value = phase.deadlineAtMs
    const command = metadata('timeout', started.snapshot.polling.roomVersion)
    const first = await service.reconcileRound(started.snapshot.roomId, 0, command, host.token)
    const second = await service.reconcileRound(started.snapshot.roomId, 0, command, host.token)
    const otherCaller = await service.reconcileRound(
      started.snapshot.roomId,
      0,
      metadata('timeout-other-caller', first.snapshot.polling.roomVersion),
      host.token,
    )
    expect(second.replayed).toBe(true)
    expect(second.snapshot.polling.roomVersion).toBe(first.snapshot.polling.roomVersion)
    expect(otherCaller.snapshot.polling.roomVersion).toBe(first.snapshot.polling.roomVersion)
    if (first.snapshot.phase.kind !== 'questionReveal') throw new Error('Expected reveal.')
    expect(first.snapshot.phase.reveal.results.every(({ outcome }) => outcome === 'missing')).toBe(true)
  })

  it('advances through rounds and completes the final round', async () => {
    const context = await startTwoPlayerGame()
    for (let round = 0; round < 5; round += 1) {
      const phase = openPhase(context.started.snapshot)
      context.clock.value = phase.deadlineAtMs
      const reveal = await context.service.reconcileRound(
        context.started.snapshot.roomId, round,
        metadata(`reconcile-${round}`, context.started.snapshot.polling.roomVersion), context.host.token,
      )
      context.started = await context.service.advanceRound(
        context.started.snapshot.roomId,
        metadata(`advance-${round}`, reveal.snapshot.polling.roomVersion), context.host.token,
      )
    }
    expect(context.started.snapshot.phase.kind).toBe('completed')
  })

  it('replays a completed game with a new game ID and reset scores', async () => {
    const context = await startTwoPlayerGame()
    const firstGameId = context.started.snapshot.gameId
    for (let round = 0; round < 5; round += 1) {
      const phase = openPhase(context.started.snapshot)
      context.clock.value = phase.deadlineAtMs
      const reveal = await context.service.reconcileRound(
        context.started.snapshot.roomId, round,
        metadata(`replay-reconcile-${round}`, context.started.snapshot.polling.roomVersion), context.host.token,
      )
      context.started = await context.service.advanceRound(
        context.started.snapshot.roomId,
        metadata(`replay-advance-${round}`, reveal.snapshot.polling.roomVersion), context.host.token,
      )
    }
    const replay = await context.service.replayGame(
      context.started.snapshot.roomId,
      metadata('replay-game', context.started.snapshot.polling.roomVersion), context.host.token,
    )
    expect(replay.snapshot.phase.kind).toBe('questionOpen')
    expect(replay.snapshot.gameId).not.toBe(firstGameId)
    expect(replay.snapshot.leaderboard.every(({ points }) => points === 0)).toBe(true)
  })

  it('derives presence without removing room membership', async () => {
    const { service, clock, host, guest } = await createAndJoin()
    clock.advance(16_000)
    const snapshot = await service.getSnapshot(host.snapshot.roomId, host.token)
    expect(snapshot.players).toHaveLength(2)
    expect(snapshot.players.find(({ playerId }) => playerId === host.playerId)?.presence).toBe('active')
    expect(snapshot.players.find(({ playerId }) => playerId === guest.playerId)?.presence).toBe('inactive')
  })
})
