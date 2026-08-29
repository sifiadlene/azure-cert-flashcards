import { describe, expect, it } from 'vitest'
import {
  CosmosExamRequestRepository,
  type ExamRequestContainerBoundary,
} from '../src/adapters/cosmosExamRequestRepository'
import { ExamRequestRepositoryConflictError } from '../src/domain/examRequests'

function cosmosError(code: number): Error & { code: number } {
  return Object.assign(new Error(`Cosmos ${code}`), { code })
}

class FakeContainer implements ExamRequestContainerBoundary {
  readonly documents = new Map<string, { resource: Record<string, unknown>; etag: string }>()
  readonly creates: Record<string, unknown>[] = []
  readonly replaces: Array<{ resource: Record<string, unknown>; partitionKey: string; ifMatch: string }> = []
  replaceConflicts = 0
  private revision = 0

  private etag(): string { this.revision += 1; return `"etag-${this.revision}"` }

  async read(id: string, partitionKey: string) {
    expect(partitionKey).toBe(id)
    const document = this.documents.get(id)
    if (!document) throw cosmosError(404)
    return structuredClone(document)
  }

  async create(resource: Record<string, unknown>) {
    this.creates.push(structuredClone(resource))
    const id = String(resource.id)
    if (this.documents.has(id)) throw cosmosError(409)
    const etag = this.etag()
    this.documents.set(id, { resource: structuredClone(resource), etag })
    return { resource: structuredClone(resource), etag }
  }

  async replace(resource: Record<string, unknown>, partitionKey: string, ifMatch: string) {
    this.replaces.push({ resource: structuredClone(resource), partitionKey, ifMatch })
    const id = String(resource.id)
    expect(partitionKey).toBe(id)
    const current = this.documents.get(id)
    if (this.replaceConflicts > 0) {
      this.replaceConflicts -= 1
      throw cosmosError(412)
    }
    if (!current || current.etag !== ifMatch) throw cosmosError(412)
    const etag = this.etag()
    this.documents.set(id, { resource: structuredClone(resource), etag })
    return { resource: structuredClone(resource), etag }
  }
}

function setup() {
  const container = new FakeContainer()
  return { container, repository: new CosmosExamRequestRepository(container) }
}

describe('CosmosExamRequestRepository', () => {
  it('creates a TTL-bound idempotency receipt and a durable per-exam reservation without ttl', async () => {
    const { container, repository } = setup()
    await expect(repository.reserve('AB-730', 'key-1', 1_000, 120)).resolves.toEqual({
      kind: 'acquired', reservationId: 'key-1', marker: expect.stringMatching(/^[a-f0-9]{64}$/), staleTakeover: false,
    })

    expect(container.creates[0]).toMatchObject({
      id: 'idempotency:key-1', type: 'idempotency', examCode: 'AB-730', ttl: 600,
    })
    expect(container.creates[1]).toMatchObject({
      id: 'exam:AB-730', type: 'exam', status: 'pending', pendingExpiresAtMs: 121_000,
    })
    expect(container.creates[1]).not.toHaveProperty('ttl')
  })

  it('returns pending for concurrent same-key retries and recovers an expired reservation with If-Match', async () => {
    const { container, repository } = setup()
    await repository.reserve('AB-730', 'key-1', 1_000, 120)
    await expect(repository.reserve('AB-730', 'key-1', 2_000, 120)).resolves.toMatchObject({ kind: 'pending' })

    const originalMarker = String(container.documents.get('exam:AB-730')?.resource.marker)
    await expect(repository.reserve('AB-730', 'key-2', 122_000, 120)).resolves.toEqual({
      kind: 'acquired', reservationId: 'key-2', marker: originalMarker, staleTakeover: true,
    })
    expect(container.replaces.at(-1)).toMatchObject({ partitionKey: 'exam:AB-730', ifMatch: '"etag-2"' })
    expect(container.replaces.at(-1)?.resource).not.toHaveProperty('ttl')
  })

  it('repairs an orphaned idempotency receipt on a same-key retry', async () => {
    const { container, repository } = setup()
    container.documents.set('idempotency:key-1', {
      resource: {
        id: 'idempotency:key-1', type: 'idempotency', examCode: 'AB-730', reservationId: 'key-1',
        marker: 'persisted-marker', createdAtMs: 1_000, ttl: 600,
      },
      etag: '"orphan"',
    })

    await expect(repository.reserve('AB-730', 'key-1', 2_000, 120)).resolves.toEqual({
      kind: 'acquired', reservationId: 'key-1', marker: 'persisted-marker', staleTakeover: false,
    })
    expect(container.documents.get('exam:AB-730')?.resource).toMatchObject({ status: 'pending', idempotencyKey: 'key-1' })
  })

  it('persists completion durably and uses the live reservation ETag', async () => {
    const { container, repository } = setup()
    await repository.reserve('AB-730', 'key-1', 1_000, 120)
    await repository.complete('AB-730', 'key-1', { number: 42, url: 'https://github.com/issue/42' }, 2_000)

    const stored = container.documents.get('exam:AB-730')?.resource
    expect(stored).toMatchObject({ status: 'completed', issue: { number: 42 }, updatedAtMs: 2_000 })
    expect(stored).not.toHaveProperty('ttl')
    await expect(repository.read('AB-730', 999_999_999)).resolves.toMatchObject({ kind: 'completed' })
  })

  it('rejects stale owners when completion loses its ETag ownership', async () => {
    const { container, repository } = setup()
    await repository.reserve('AB-730', 'key-1', 1_000, 120)
    container.replaceConflicts = 1
    await expect(repository.complete('AB-730', 'key-1', { number: 42, url: 'https://github.com/issue/42' }, 2_000))
      .rejects.toBeInstanceOf(ExamRequestRepositoryConflictError)
  })

  it('atomically caps active claims and counts only finalized claims', async () => {
    const { container, repository } = setup()
    const attempts = await Promise.all(Array.from({ length: 8 }, (_, index) => (
      repository.claimRateLimit('rate:1:hash', `claim-${index}`, 1_000, 172_800, 300, 3)
    )))
    expect(attempts.filter(Boolean)).toHaveLength(3)
    expect(container.documents.get('rate:1:hash')?.resource).toMatchObject({ count: 0, ttl: 172_800 })

    const accepted = attempts.flatMap((value, index) => value ? [`claim-${index}`] : [])
    await repository.finalizeRateLimit({ key: 'rate:1:hash', claimId: accepted[0] as string }, 2_000, 172_800)
    await repository.releaseRateLimit({ key: 'rate:1:hash', claimId: accepted[1] as string }, 2_000, 172_800)
    await repository.finalizeRateLimit({ key: 'rate:1:hash', claimId: accepted[0] as string }, 2_000, 172_800)
    expect(container.documents.get('rate:1:hash')?.resource).toMatchObject({ count: 1 })
    expect(container.replaces.filter(({ resource }) => resource.id === 'rate:1:hash').every(({ resource }) => resource.ttl === 172_800)).toBe(true)
  })

  it('prunes stale claims so abandoned attempts do not consume or reserve quota', async () => {
    const { container, repository } = setup()
    await expect(repository.claimRateLimit('rate:1:hash', 'abandoned', 1_000, 172_800, 1, 1)).resolves.toBe(true)
    await expect(repository.claimRateLimit('rate:1:hash', 'blocked', 1_500, 172_800, 1, 1)).resolves.toBe(false)
    await expect(repository.claimRateLimit('rate:1:hash', 'replacement', 2_001, 172_800, 1, 1)).resolves.toBe(true)
    expect(container.documents.get('rate:1:hash')?.resource).toMatchObject({
      count: 0,
      claims: { replacement: 3_001 },
    })
  })

  it('accounts separately when an expired receipt UUID is reused for another exam', async () => {
    const { container, repository } = setup()
    const idempotencyKey = '48e228f6-c629-46d4-bb37-00510cfbc274'
    const rateKey = 'rate:1:hash'

    await repository.reserve('AB-730', idempotencyKey, 1_000, 120)
    const firstClaim = { key: rateKey, claimId: `AB-730:${idempotencyKey}` }
    await expect(repository.claimRateLimit(rateKey, firstClaim.claimId, 1_000, 172_800, 300, 3)).resolves.toBe(true)
    await repository.finalizeRateLimit(firstClaim, 2_000, 172_800)

    container.documents.delete(`idempotency:${idempotencyKey}`)

    await repository.reserve('AB-731', idempotencyKey, 602_000, 120)
    const secondClaim = { key: rateKey, claimId: `AB-731:${idempotencyKey}` }
    await expect(repository.claimRateLimit(rateKey, secondClaim.claimId, 602_000, 172_800, 300, 3)).resolves.toBe(true)
    await repository.finalizeRateLimit(secondClaim, 603_000, 172_800)

    expect(container.documents.get(rateKey)?.resource).toMatchObject({
      count: 2,
      finalizedClaimIds: [firstClaim.claimId, secondClaim.claimId],
    })
  })

  it('persists reconciliation without expiry before issue creation can start', async () => {
    const { container, repository } = setup()
    await repository.reserve('AB-730', 'key-1', 1_000, 120)
    await repository.beginIssueCreation(
      'AB-730', 'key-1', { key: 'rate:1:hash', claimId: 'key-1' }, 2_000,
    )
    await expect(repository.read('AB-730', 3_000)).resolves.toEqual({
      kind: 'reconciling',
      reservationId: 'key-1',
      marker: expect.stringMatching(/^[a-f0-9]{64}$/),
      rateClaim: { key: 'rate:1:hash', claimId: 'key-1' },
    })
    expect(container.documents.get('exam:AB-730')?.resource).not.toHaveProperty('pendingExpiresAtMs')
    await expect(repository.reserve('AB-730', 'key-2', 3_000, 120)).resolves.toMatchObject({ kind: 'reconciling' })
    await expect(repository.reserve('AB-730', 'key-3', 3_602_001, 120)).resolves.toMatchObject({
      kind: 'reconciling', reservationId: 'key-1',
    })
  })

  it('prevents one idempotency key from being rebound to another exam', async () => {
    const { repository } = setup()
    await repository.reserve('AB-730', 'key-1', 1_000, 120)
    await expect(repository.reserve('ZZ-999', 'key-1', 2_000, 120)).rejects.toBeInstanceOf(ExamRequestRepositoryConflictError)
  })
})