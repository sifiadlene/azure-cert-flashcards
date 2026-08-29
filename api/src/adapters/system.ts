import { createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import type {
  CapabilityTokenService,
  Clock,
  IdGenerator,
  RandomSource,
} from '../application/ports'
import type { CapabilityHash } from '../domain/entities'

const ROOM_CODE_ALPHABET = '23456789BCDFGHJKMNPQRTVWXYZ'

function base64Url(buffer: Buffer): string {
  return buffer.toString('base64url')
}

export class SystemClock implements Clock {
  nowMs(): number {
    return Date.now()
  }
}

export class CryptoIdGenerator implements IdGenerator {
  roomId(): string {
    return randomUUID()
  }

  roomCode(): string {
    const bytes = randomBytes(6)
    return Array.from(bytes, (value) => ROOM_CODE_ALPHABET[value % ROOM_CODE_ALPHABET.length]).join('')
  }

  playerId(): string {
    return randomUUID()
  }

  gameId(): string {
    return randomUUID()
  }
}

export class CryptoRandomSource implements RandomSource {
  shuffled<T>(values: readonly T[]): T[] {
    const result = [...values]
    for (let index = result.length - 1; index > 0; index -= 1) {
      const random = randomBytes(4).readUInt32BE() / 0x1_0000_0000
      const swapIndex = Math.floor(random * (index + 1))
      ;[result[index], result[swapIndex]] = [result[swapIndex], result[index]]
    }
    return result
  }
}

export class PepperedCapabilityTokenService implements CapabilityTokenService {
  constructor(private readonly pepper: Buffer) {
    if (pepper.byteLength < 32) {
      throw new Error('CHALLENGE_TOKEN_PEPPER must contain at least 32 bytes.')
    }
  }

  issue(purpose: string): { rawToken: string; stored: CapabilityHash } {
    const rawToken = base64Url(createHmac('sha256', this.pepper).update(`token:${purpose}`).digest())
    const salt = base64Url(createHmac('sha256', this.pepper).update(`salt:${purpose}`).digest().subarray(0, 16))
    return { rawToken, stored: { salt, digest: this.digest(rawToken, salt) } }
  }

  verify(rawToken: string, stored: CapabilityHash): boolean {
    if (rawToken.length < 22 || stored.digest.length === 0) {
      return false
    }
    const expected = Buffer.from(stored.digest, 'base64url')
    const actual = Buffer.from(this.digest(rawToken, stored.salt), 'base64url')
    return expected.byteLength === actual.byteLength && timingSafeEqual(expected, actual)
  }

  deriveKey(purpose: string): string {
    return base64Url(createHmac('sha256', this.pepper).update(`key:${purpose}`).digest())
  }

  private digest(rawToken: string, salt: string): string {
    return base64Url(createHmac('sha256', this.pepper)
      .update(Buffer.from(salt, 'base64url'))
      .update(rawToken)
      .digest())
  }
}
