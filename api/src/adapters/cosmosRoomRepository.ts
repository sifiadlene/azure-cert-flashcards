import {
  BulkOperationType,
  CosmosClient,
  type Container,
  type JSONObject,
  type OperationInput,
} from '@azure/cosmos'
import { DefaultAzureCredential } from '@azure/identity'
import type { RoomCommit, RoomRepository } from '../application/ports'
import type { RoomEntity } from '../domain/entities'
import {
  DuplicateAnswerStorageError,
  DuplicateRoomError,
  RepositoryConflictError,
} from '../domain/errors'

const ROOM_ITEM_ID = 'room'
const MAX_TOUCH_ATTEMPTS = 3
const MAPPED_ROOM_READ_ATTEMPTS = 3
const MAPPED_ROOM_READ_DELAY_MS = 25

export interface CosmosStoredResource {
  resource?: unknown
  etag?: string
}

export interface CosmosBatchOperation {
  kind: 'create' | 'replace'
  resource: Record<string, unknown>
  ifMatch?: string
}

export interface CosmosBatchResult {
  statusCode: number
  operationStatusCodes: number[]
  replaceEtag?: string
}

export interface CosmosContainerBoundary {
  read(id: string, partitionKey: string): Promise<CosmosStoredResource>
  create(resource: Record<string, unknown>): Promise<CosmosStoredResource>
  replace(resource: Record<string, unknown>, partitionKey: string, ifMatch: string): Promise<CosmosStoredResource>
  delete(id: string, partitionKey: string, ifMatch?: string): Promise<void>
  batch(operations: CosmosBatchOperation[], partitionKey: string): Promise<CosmosBatchResult>
}

export interface CosmosRoomRepositoryOptions {
  rooms: CosmosContainerBoundary
  roomCodes: CosmosContainerBoundary
  mappedRoomReadAttempts?: number
  mappedRoomReadDelay?: (delayMs: number) => Promise<void>
}

export interface CosmosRoomRepositoryConfiguration {
  endpoint?: string
  connectionString?: string
  databaseId: string
  roomsContainerId: string
  roomCodesContainerId: string
}

interface RoomCodeItem {
  id: string
  roomCode: string
  roomId: string
  ttl: number
}

function delay(delayMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, delayMs))
}

function statusCode(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null) return undefined
  const candidate = error as { code?: unknown; statusCode?: unknown }
  if (typeof candidate.statusCode === 'number') return candidate.statusCode
  return typeof candidate.code === 'number' ? candidate.code : undefined
}

function withoutStorageEtag(room: RoomEntity): Record<string, unknown> {
  const stored = structuredClone(room) as RoomEntity
  delete stored.storageEtag
  return stored as unknown as Record<string, unknown>
}

function deserializeRoom(value: unknown, etag?: string): RoomEntity {
  const room = structuredClone(value) as RoomEntity
  room.storageEtag = etag
  return room
}

function answerMarkerId(room: RoomEntity, answerId: string): string {
  const answer = room.answers[answerId]
  if (!answer) throw new Error(`Missing answer entity for deterministic marker ${answerId}.`)
  return `answer:${answer.gameId}:${answer.roundIndex}:${answer.playerId}`
}

class AzureCosmosContainerBoundary implements CosmosContainerBoundary {
  constructor(private readonly container: Container) {}

  async read(id: string, partitionKey: string): Promise<CosmosStoredResource> {
    const response = await this.container.item(id, partitionKey).read()
    return { resource: response.resource, etag: response.etag }
  }

  async create(resource: Record<string, unknown>): Promise<CosmosStoredResource> {
    const response = await this.container.items.create(resource as JSONObject)
    return { resource: response.resource, etag: response.etag }
  }

  async replace(resource: Record<string, unknown>, partitionKey: string, ifMatch: string): Promise<CosmosStoredResource> {
    const response = await this.container.item(String(resource.id), partitionKey).replace(resource as JSONObject, {
      accessCondition: { type: 'IfMatch', condition: ifMatch },
    })
    return { resource: response.resource, etag: response.etag }
  }

  async delete(id: string, partitionKey: string, ifMatch?: string): Promise<void> {
    await this.container.item(id, partitionKey).delete(ifMatch
      ? { accessCondition: { type: 'IfMatch', condition: ifMatch } }
      : undefined)
  }

  async batch(operations: CosmosBatchOperation[], partitionKey: string): Promise<CosmosBatchResult> {
    const sdkOperations: OperationInput[] = operations.map((operation) => operation.kind === 'create'
      ? {
          operationType: BulkOperationType.Create,
          resourceBody: operation.resource as JSONObject,
        }
      : {
          operationType: BulkOperationType.Replace,
          id: String(operation.resource.id),
          resourceBody: operation.resource as JSONObject,
          ifMatch: operation.ifMatch,
        })
    const response = await this.container.items.batch(sdkOperations, partitionKey)
    const results = response.result ?? []
    return {
      statusCode: response.code ?? results.at(-1)?.statusCode ?? 500,
      operationStatusCodes: results.map(({ statusCode: operationStatus }) => operationStatus),
      replaceEtag: results.at(-1)?.eTag,
    }
  }
}

/**
 * Stores one room aggregate and deterministic answer markers in a /roomId partition.
 * A separate /roomCode lookup container enables two point reads instead of a scan. Creating
 * the mapping first makes code ownership unique; a failed room create conditionally removes
 * its mapping. The two containers are not transactional, so a process crash can leave a
 * short-lived (TTL-bound) orphan mapping that behaves like a temporary code collision.
 */
export class CosmosRoomRepository implements RoomRepository {
  constructor(private readonly options: CosmosRoomRepositoryOptions) {}

  static fromConfiguration(configuration: CosmosRoomRepositoryConfiguration): CosmosRoomRepository {
    const client = configuration.connectionString
      ? new CosmosClient(configuration.connectionString)
      : new CosmosClient({
          endpoint: configuration.endpoint ?? '',
          aadCredentials: new DefaultAzureCredential(),
        })
    const database = client.database(configuration.databaseId)
    return new CosmosRoomRepository({
      rooms: new AzureCosmosContainerBoundary(database.container(configuration.roomsContainerId)),
      roomCodes: new AzureCosmosContainerBoundary(database.container(configuration.roomCodesContainerId)),
    })
  }

  async create(room: RoomEntity, createKey: string): Promise<void> {
    const receipt: RoomCodeItem = {
      id: createKey,
      roomCode: createKey,
      roomId: room.roomId,
      ttl: room.ttl,
    }
    const mapping: RoomCodeItem = {
      id: room.roomCode,
      roomCode: room.roomCode,
      roomId: room.roomId,
      ttl: room.ttl,
    }
    let receiptEtag: string | undefined
    let mappingEtag: string | undefined
    try {
      receiptEtag = (await this.options.roomCodes.create(receipt as unknown as Record<string, unknown>)).etag
      mappingEtag = (await this.options.roomCodes.create(mapping as unknown as Record<string, unknown>)).etag
    } catch (error) {
      if (receiptEtag) {
        try {
          await this.options.roomCodes.delete(receipt.id, receipt.roomCode, receiptEtag)
        } catch {
          // TTL bounds an idempotency reservation if conditional compensation loses a race.
        }
      }
      if (statusCode(error) === 409) throw new DuplicateRoomError()
      throw error
    }

    try {
      const response = await this.options.rooms.create(withoutStorageEtag(room))
      room.storageEtag = response.etag
    } catch (error) {
      try {
        await this.options.roomCodes.delete(mapping.id, mapping.roomCode, mappingEtag)
        await this.options.roomCodes.delete(receipt.id, receipt.roomCode, receiptEtag)
      } catch {
        // The mapping TTL safely bounds cleanup if conditional compensation cannot complete.
      }
      if (statusCode(error) === 409) throw new DuplicateRoomError()
      throw error
    }
  }

  async getById(roomId: string): Promise<RoomEntity | null> {
    try {
      const response = await this.options.rooms.read(ROOM_ITEM_ID, roomId)
      return response.resource ? deserializeRoom(response.resource, response.etag) : null
    } catch (error) {
      if (statusCode(error) === 404) return null
      throw error
    }
  }

  async getByCode(roomCode: string): Promise<RoomEntity | null> {
    return this.getByMapping(roomCode)
  }

  async getByCreateKey(createKey: string): Promise<RoomEntity | null> {
    return this.getByMapping(createKey)
  }

  private async getByMapping(mappingKey: string): Promise<RoomEntity | null> {
    let mapping: CosmosStoredResource
    try {
      mapping = await this.options.roomCodes.read(mappingKey, mappingKey)
    } catch (error) {
      if (statusCode(error) === 404) return null
      throw error
    }
    const roomId = (mapping.resource as RoomCodeItem | undefined)?.roomId
    if (!roomId) return null
    const attempts = this.options.mappedRoomReadAttempts ?? MAPPED_ROOM_READ_ATTEMPTS
    const wait = this.options.mappedRoomReadDelay ?? delay
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const room = await this.getById(roomId)
      if (room) return room
      if (attempt + 1 < attempts) await wait(MAPPED_ROOM_READ_DELAY_MS)
    }
    return null
  }

  async commit(change: RoomCommit): Promise<void> {
    const storageEtag = change.expectedStorageEtag
    if (!storageEtag) throw new RepositoryConflictError()
    const markerOperations: CosmosBatchOperation[] = (change.insertedAnswerIds ?? []).map((id) => ({
      kind: 'create',
      resource: {
        id: answerMarkerId(change.room, id),
        roomId: change.room.roomId,
        ttl: change.room.answers[id]?.ttl ?? change.room.ttl,
      },
    }))
    const operations: CosmosBatchOperation[] = [
      ...markerOperations,
      { kind: 'replace', resource: withoutStorageEtag(change.room), ifMatch: storageEtag },
    ]

    try {
      const response = await this.options.rooms.batch(operations, change.room.roomId)
      if (response.statusCode === 409 || response.operationStatusCodes.includes(409)) {
        if (markerOperations.length > 0) throw new DuplicateAnswerStorageError(change.insertedAnswerIds?.[0] ?? '')
        throw new RepositoryConflictError()
      }
      if (response.statusCode === 412 || response.operationStatusCodes.includes(412)) {
        throw new RepositoryConflictError()
      }
      if (response.statusCode < 200 || response.statusCode >= 300) {
        throw new Error(`Cosmos transactional batch failed with status ${response.statusCode}.`)
      }
      change.room.storageEtag = response.replaceEtag
      await this.refreshMappings(change.room)
    } catch (error) {
      if (error instanceof DuplicateAnswerStorageError || error instanceof RepositoryConflictError) throw error
      if (statusCode(error) === 409 && markerOperations.length > 0) {
        throw new DuplicateAnswerStorageError(change.insertedAnswerIds?.[0] ?? '')
      }
      if (statusCode(error) === 409 || statusCode(error) === 412) throw new RepositoryConflictError()
      throw error
    }
  }

  async touch(roomId: string, playerId: string, nowMs: number): Promise<void> {
    for (let attempt = 0; attempt < MAX_TOUCH_ATTEMPTS; attempt += 1) {
      const room = await this.getById(roomId)
      const player = room?.players.find((candidate) => candidate.playerId === playerId)
      if (!room || !player || !room.storageEtag) return
      player.lastSeenAtMs = Math.max(player.lastSeenAtMs, nowMs)
      room.lastActivityAtMs = Math.max(room.lastActivityAtMs, nowMs)
      try {
        await this.options.rooms.replace(withoutStorageEtag(room), roomId, room.storageEtag)
        await this.refreshMappings(room)
        return
      } catch (error) {
        if (statusCode(error) !== 412) return
      }
    }
  }

  private async refreshMappings(room: RoomEntity): Promise<void> {
    for (const key of [room.roomCode, room.createKey]) {
      try {
        const current = await this.options.roomCodes.read(key, key)
        const mapping = current.resource as RoomCodeItem | undefined
        if (!mapping || mapping.roomId !== room.roomId || !current.etag) continue
        await this.options.roomCodes.replace({
          id: key,
          roomCode: key,
          roomId: room.roomId,
          ttl: room.ttl,
        }, key, current.etag)
      } catch {
        // Mapping refresh is best effort. Room mutations remain authoritative and mapping TTL
        // provides bounded cleanup without risking a second owner for the same active key.
      }
    }
  }
}