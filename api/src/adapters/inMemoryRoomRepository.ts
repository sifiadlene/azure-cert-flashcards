import type { RoomCommit, RoomRepository } from '../application/ports'
import type { RoomEntity } from '../domain/entities'
import {
  DuplicateAnswerStorageError,
  DuplicateRoomError,
  RepositoryConflictError,
} from '../domain/errors'

function clone(room: RoomEntity): RoomEntity {
  return structuredClone(room)
}

export class InMemoryRoomRepository implements RoomRepository {
  private readonly rooms = new Map<string, RoomEntity>()
  private readonly roomCodes = new Map<string, string>()
  private readonly createKeys = new Map<string, string>()
  private forcedConflicts = 0

  forceConflicts(count: number): void {
    this.forcedConflicts = count
  }

  async create(room: RoomEntity, createKey: string): Promise<void> {
    if (this.rooms.has(room.roomId) || this.roomCodes.has(room.roomCode) || this.createKeys.has(createKey)) {
      throw new DuplicateRoomError()
    }
    this.rooms.set(room.roomId, clone(room))
    this.roomCodes.set(room.roomCode, room.roomId)
    this.createKeys.set(createKey, room.roomId)
  }

  async getById(roomId: string): Promise<RoomEntity | null> {
    const room = this.rooms.get(roomId)
    return room ? clone(room) : null
  }

  async getByCode(roomCode: string): Promise<RoomEntity | null> {
    const roomId = this.roomCodes.get(roomCode)
    return roomId ? this.getById(roomId) : null
  }

  async getByCreateKey(createKey: string): Promise<RoomEntity | null> {
    const roomId = this.createKeys.get(createKey)
    return roomId ? this.getById(roomId) : null
  }

  async commit(change: RoomCommit): Promise<void> {
    const current = this.rooms.get(change.room.roomId)
    if (!current || current.etag !== change.expectedEtag || this.forcedConflicts > 0) {
      if (this.forcedConflicts > 0) {
        this.forcedConflicts -= 1
      }
      throw new RepositoryConflictError()
    }

    for (const id of change.insertedAnswerIds ?? []) {
      if (current.answers[id]) {
        throw new DuplicateAnswerStorageError(id)
      }
    }

    this.rooms.set(change.room.roomId, clone(change.room))
  }

  async touch(roomId: string, playerId: string, nowMs: number): Promise<void> {
    const room = this.rooms.get(roomId)
    const player = room?.players.find((candidate) => candidate.playerId === playerId)
    if (!room || !player) {
      return
    }
    player.lastSeenAtMs = Math.max(player.lastSeenAtMs, nowMs)
    room.lastActivityAtMs = Math.max(room.lastActivityAtMs, nowMs)
  }
}
