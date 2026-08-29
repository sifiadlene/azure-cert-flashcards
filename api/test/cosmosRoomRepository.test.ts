import { describe, expect, it } from 'vitest'
import type { ChallengeSettings } from '../../web/src/challenge/contracts'
import {
  CosmosRoomRepository,
  type CosmosBatchOperation,
  type CosmosBatchResult,
  type CosmosContainerBoundary,
  type CosmosRoomRepositoryConfiguration,
  type CosmosStoredResource,
} from '../src/adapters/cosmosRoomRepository'
import { cosmosConfiguration, createChallengeServiceFromEnvironment } from '../src/application/composition'
import type { RoomEntity } from '../src/domain/entities'
import {
  DuplicateAnswerStorageError,
  DuplicateRoomError,
  RepositoryConflictError,
} from '../src/domain/errors'

function cosmosError(code: number): Error & { code: number } {
  return Object.assign(new Error(`Cosmos ${code}`), { code })
}

class FakeContainer implements CosmosContainerBoundary {
  readonly documents = new Map<string, { resource: Record<string, unknown>; etag: string }>()
  readonly reads: Array<{ id: string; partitionKey: string }> = []
  readonly creates: Record<string, unknown>[] = []
  readonly replaces: Array<{ resource: Record<string, unknown>; partitionKey: string; ifMatch: string }> = []
  readonly batches: Array<{ operations: CosmosBatchOperation[]; partitionKey: string }> = []
  nextBatchResult?: CosmosBatchResult
  nextBatchError?: unknown
  replaceConflicts = 0
  readMisses = new Map<string, number>()
  private revision = 0

  private key(id: string, partitionKey: string): string { return `${partitionKey}|${id}` }
  private etag(): string { this.revision += 1; return `"storage-${this.revision}"` }

  async read(id: string, partitionKey: string): Promise<CosmosStoredResource> {
    this.reads.push({ id, partitionKey })
    const misses = this.readMisses.get(this.key(id, partitionKey)) ?? 0
    if (misses > 0) {
      this.readMisses.set(this.key(id, partitionKey), misses - 1)
      throw cosmosError(404)
    }
    const document = this.documents.get(this.key(id, partitionKey))
    if (!document) throw cosmosError(404)
    return structuredClone(document)
  }

  async create(resource: Record<string, unknown>): Promise<CosmosStoredResource> {
    this.creates.push(structuredClone(resource))
    const partitionKey = String(resource.id === 'room' ? resource.roomId : resource.roomCode)
    const key = this.key(String(resource.id), partitionKey)
    if (this.documents.has(key)) throw cosmosError(409)
    const etag = this.etag()
    this.documents.set(key, { resource: structuredClone(resource), etag })
    return { resource: structuredClone(resource), etag }
  }

  async replace(resource: Record<string, unknown>, partitionKey: string, ifMatch: string): Promise<CosmosStoredResource> {
    this.replaces.push({ resource: structuredClone(resource), partitionKey, ifMatch })
    if (this.replaceConflicts > 0) {
      this.replaceConflicts -= 1
      throw cosmosError(412)
    }
    const key = this.key(String(resource.id), partitionKey)
    const current = this.documents.get(key)
    if (!current || current.etag !== ifMatch) throw cosmosError(412)
    const etag = this.etag()
    this.documents.set(key, { resource: structuredClone(resource), etag })
    return { resource: structuredClone(resource), etag }
  }

  async delete(id: string, partitionKey: string, ifMatch?: string): Promise<void> {
    const key = this.key(id, partitionKey)
    const current = this.documents.get(key)
    if (ifMatch && current?.etag !== ifMatch) throw cosmosError(412)
    this.documents.delete(key)
  }

  async batch(operations: CosmosBatchOperation[], partitionKey: string): Promise<CosmosBatchResult> {
    this.batches.push({ operations: structuredClone(operations), partitionKey })
    if (this.nextBatchError) throw this.nextBatchError
    if (this.nextBatchResult) return this.nextBatchResult

    for (const operation of operations) {
      const id = String(operation.resource.id)
      const current = this.documents.get(this.key(id, partitionKey))
      if (operation.kind === 'create' && current) {
        return { statusCode: 409, operationStatusCodes: [409] }
      }
      if (operation.kind === 'replace' && current?.etag !== operation.ifMatch) {
        return { statusCode: 412, operationStatusCodes: [412] }
      }
    }

    let replaceEtag: string | undefined
    for (const operation of operations) {
      const etag = this.etag()
      this.documents.set(this.key(String(operation.resource.id), partitionKey), {
        resource: structuredClone(operation.resource),
        etag,
      })
      if (operation.kind === 'replace') replaceEtag = etag
    }
    return { statusCode: 200, operationStatusCodes: operations.map(() => 200), replaceEtag }
  }
}

const settings: ChallengeSettings = {
  examSlug: 'gh300',
  deckVersion: '2026-08-28',
  scope: { kind: 'all' },
  questionCount: 5,
  timerSeconds: 15,
}

function room(): RoomEntity {
  return {
    id: 'room',
    roomId: 'room-1',
    roomCode: 'ABC234',
    createKey: 'create-key',
    ttl: 86_400,
    version: 1,
    etag: '"room-1"',
    createdAtMs: 1_000,
    lastActivityAtMs: 1_000,
    settings,
    gameId: 'game-1',
    phase: { kind: 'lobby' },
    questionOrder: [],
    players: [{
      playerId: 'player-1',
      nickname: 'Host',
      nicknameKey: 'host',
      role: 'host',
      joinOrder: 1,
      joinedAtMs: 1_000,
      lastSeenAtMs: 1_000,
      capability: { salt: 'salt', digest: 'digest' },
      points: 0,
      correctCount: 0,
      cumulativeResponseTimeMs: 0,
    }],
    answers: {},
    roundResults: {},
    commandReceipts: {},
  }
}

function setup() {
  const rooms = new FakeContainer()
  const roomCodes = new FakeContainer()
  return {
    repository: new CosmosRoomRepository({ rooms, roomCodes, mappedRoomReadDelay: async () => undefined }),
    rooms,
    roomCodes,
  }
}

describe('CosmosRoomRepository', () => {
  it('serializes TTL and uses point-readable room and code partition/id mappings', async () => {
    const { repository, rooms, roomCodes } = setup()
    const entity = room()
    await repository.create(entity, 'create-key')

    expect(rooms.creates[0]).toMatchObject({ id: 'room', roomId: 'room-1', ttl: 86_400 })
    expect(rooms.creates[0]).not.toHaveProperty('storageEtag')
    expect(roomCodes.creates[0]).toEqual({ id: 'create-key', roomCode: 'create-key', roomId: 'room-1', ttl: 86_400 })
    expect(roomCodes.creates[1]).toEqual({ id: 'ABC234', roomCode: 'ABC234', roomId: 'room-1', ttl: 86_400 })
    expect(entity.storageEtag).toBe('"storage-1"')

    const byId = await repository.getById('room-1')
    const byCode = await repository.getByCode('ABC234')
    expect(byId?.roomId).toBe('room-1')
    expect(byCode?.roomId).toBe('room-1')
    expect(rooms.reads).toContainEqual({ id: 'room', partitionKey: 'room-1' })
    expect(roomCodes.reads).toContainEqual({ id: 'ABC234', partitionKey: 'ABC234' })
  })

  it('makes room-code ownership collision-safe and translates create 409', async () => {
    const { repository } = setup()
    await repository.create(room(), 'create-key-1')
    const collision = room()
    collision.roomId = 'room-2'
    await expect(repository.create(collision, 'create-key-2')).rejects.toBeInstanceOf(DuplicateRoomError)
  })

  it('commits deterministic per-game answer markers and the aggregate atomically with If-Match', async () => {
    const { repository, rooms } = setup()
    const entity = room()
    await repository.create(entity, 'create-key')
    entity.answers['answer:0:player-1'] = {
      id: 'answer:0:player-1', roomId: entity.roomId, gameId: 'game-1', roundIndex: 0,
      playerId: 'player-1', selectedOption: 'A', receivedAtMs: 2_000, outcome: 'correct',
      responseTimeMs: 1_000, speedBonus: 150, pointsAwarded: 1_150, ttl: 86_400,
    }
    entity.version = 2
    entity.etag = '"room-2"'
    await repository.commit({
      room: entity,
      expectedEtag: '"room-1"',
      expectedStorageEtag: '"storage-1"',
      insertedAnswerIds: ['answer:0:player-1'],
    })

    expect(rooms.batches[0]?.partitionKey).toBe('room-1')
    expect(rooms.batches[0]?.operations[0]).toEqual({
      kind: 'create',
      resource: { id: 'answer:game-1:0:player-1', roomId: 'room-1', ttl: 86_400 },
    })
    expect(rooms.batches[0]?.operations[1]).toMatchObject({ kind: 'replace', ifMatch: '"storage-1"' })
    expect(entity.storageEtag).toBe('"storage-3"')
  })

  it('translates duplicate marker 409 and conditional 412 outcomes', async () => {
    const duplicate = setup()
    const duplicateRoom = room()
    await duplicate.repository.create(duplicateRoom, 'create-key')
    duplicateRoom.answers.answer = {
      id: 'answer', roomId: 'room-1', gameId: 'game-1', roundIndex: 0, playerId: 'player-1',
      selectedOption: 'A', receivedAtMs: 2_000, outcome: 'correct', responseTimeMs: 1_000,
      speedBonus: 150, pointsAwarded: 1_150, ttl: 86_400,
    }
    duplicate.rooms.nextBatchResult = { statusCode: 409, operationStatusCodes: [409] }
    await expect(duplicate.repository.commit({
      room: duplicateRoom,
      expectedEtag: duplicateRoom.etag,
      expectedStorageEtag: duplicateRoom.storageEtag,
      insertedAnswerIds: ['answer'],
    })).rejects.toBeInstanceOf(DuplicateAnswerStorageError)

    const conflict = setup()
    const conflictRoom = room()
    await conflict.repository.create(conflictRoom, 'create-key')
    conflict.rooms.nextBatchError = cosmosError(412)
    await expect(conflict.repository.commit({
      room: conflictRoom,
      expectedEtag: conflictRoom.etag,
      expectedStorageEtag: conflictRoom.storageEtag,
    }))
      .rejects.toBeInstanceOf(RepositoryConflictError)
  })

  it('touches presence with a storage ETag while preserving the logical HTTP ETag and refreshing mapping TTL', async () => {
    const { repository, rooms, roomCodes } = setup()
    const entity = room()
    await repository.create(entity, 'create-key')
    await repository.touch('room-1', 'player-1', 5_000)

    const stored = await repository.getById('room-1')
    expect(stored).toMatchObject({ etag: '"room-1"', lastActivityAtMs: 5_000 })
    expect(stored?.players[0]?.lastSeenAtMs).toBe(5_000)
    expect(rooms.replaces[0]).toMatchObject({ partitionKey: 'room-1', ifMatch: '"storage-1"' })
    expect(roomCodes.replaces[0]).toMatchObject({ partitionKey: 'ABC234', ifMatch: '"storage-2"' })
    expect(roomCodes.replaces[0]?.resource.ttl).toBe(86_400)
    expect(roomCodes.replaces[1]).toMatchObject({ partitionKey: 'create-key', ifMatch: '"storage-1"' })
  })

  it('retries a room point read when a code mapping is visible first', async () => {
    const { repository, rooms } = setup()
    await repository.create(room(), 'create-key')
    rooms.readMisses.set('room-1|room', 1)

    await expect(repository.getByCode('ABC234')).resolves.toMatchObject({ roomId: 'room-1' })
    expect(rooms.reads.filter(({ id }) => id === 'room')).toHaveLength(2)
  })

  it('treats repeated presence write conflicts as best effort', async () => {
    const { repository, rooms } = setup()
    await repository.create(room(), 'create-key')
    rooms.replaceConflicts = 3

    await expect(repository.touch('room-1', 'player-1', 5_000)).resolves.toBeUndefined()
    expect(rooms.replaces).toHaveLength(3)
  })
})

describe('production composition configuration', () => {
  const productionEnvironment = {
    NODE_ENV: 'production',
    CHALLENGE_TOKEN_PEPPER: Buffer.alloc(32, 1).toString('base64'),
    CHALLENGE_COSMOS_ENDPOINT: 'https://example.documents.azure.com:443/',
    CHALLENGE_COSMOS_DATABASE: 'challenge',
    CHALLENGE_COSMOS_ROOMS_CONTAINER: 'rooms',
    CHALLENGE_COSMOS_ROOM_CODES_CONTAINER: 'room-codes',
  }

  it('fails fast for missing production Cosmos settings and disallows emulator credentials in production', () => {
    expect(() => cosmosConfiguration({ ...productionEnvironment, CHALLENGE_COSMOS_ENDPOINT: '' }))
      .toThrow('CHALLENGE_COSMOS_ENDPOINT is required')
    expect(() => cosmosConfiguration({
      ...productionEnvironment,
      CHALLENGE_COSMOS_EMULATOR_CONNECTION_STRING: 'AccountEndpoint=https://localhost:8081/;',
    })).toThrow('local development only')
  })

  it('selects Cosmos unless local in-memory mode is explicitly true', () => {
    let received: CosmosRoomRepositoryConfiguration | undefined
    const fakeRepository = setup().repository
    createChallengeServiceFromEnvironment(productionEnvironment, (configuration) => {
      received = configuration
      return fakeRepository
    })
    expect(received).toMatchObject({
      endpoint: productionEnvironment.CHALLENGE_COSMOS_ENDPOINT,
      databaseId: 'challenge',
      roomsContainerId: 'rooms',
      roomCodesContainerId: 'room-codes',
    })

    let called = false
    createChallengeServiceFromEnvironment({
      CHALLENGE_LOCAL_IN_MEMORY: 'true',
      CHALLENGE_TOKEN_PEPPER: productionEnvironment.CHALLENGE_TOKEN_PEPPER,
    }, () => {
      called = true
      return fakeRepository
    })
    expect(called).toBe(false)
  })
})
