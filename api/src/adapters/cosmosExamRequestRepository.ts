import { randomBytes } from 'node:crypto'
import { CosmosClient, type Container, type JSONObject } from '@azure/cosmos'
import { DefaultAzureCredential } from '@azure/identity'
import type { ExamRequestRepository } from '../application/examRequestPorts'
import {
  ExamRequestRepositoryConflictError,
  ExamRequestRepositoryUnavailableError,
  type ExamRequestIssue,
  type ExamReservation,
  type RateLimitClaim,
} from '../domain/examRequests'

const RATE_UPDATE_ATTEMPTS = 20

interface StoredResource {
  resource?: unknown
  etag?: string
}

export interface ExamRequestContainerBoundary {
  read(id: string, partitionKey: string): Promise<StoredResource>
  create(resource: Record<string, unknown>): Promise<StoredResource>
  replace(resource: Record<string, unknown>, partitionKey: string, ifMatch: string): Promise<StoredResource>
}

export interface CosmosExamRequestRepositoryConfiguration {
  endpoint?: string
  connectionString?: string
  databaseId: string
  containerId: string
}

interface IdempotencyItem {
  id: string
  type: 'idempotency'
  examCode: string
  reservationId: string
  marker: string
  createdAtMs: number
  ttl: number
}

interface ExamItem {
  id: string
  type: 'exam'
  examCode: string
  status: 'pending' | 'reconciling' | 'completed' | 'retryable'
  reservationId: string
  marker: string
  idempotencyKey: string
  pendingExpiresAtMs?: number
  rateClaim?: RateLimitClaim
  updatedAtMs: number
  issue?: ExamRequestIssue
}

interface RateItem {
  id: string
  type: 'rate'
  count: number
  claims: Record<string, number>
  finalizedClaimIds: string[]
  updatedAtMs: number
  ttl: number
}

function statusCode(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null) return undefined
  const candidate = error as { code?: unknown; statusCode?: unknown }
  if (typeof candidate.statusCode === 'number') return candidate.statusCode
  return typeof candidate.code === 'number' ? candidate.code : undefined
}

function examId(examCode: string): string {
  return `exam:${examCode}`
}

function idempotencyId(idempotencyKey: string): string {
  return `idempotency:${idempotencyKey}`
}

function asReservation(item: ExamItem, nowMs: number): ExamReservation | null {
  if (item.status === 'completed' && item.issue) {
    return { kind: 'completed', reservationId: item.reservationId, marker: item.marker, issue: item.issue }
  }
  if (item.status === 'pending' && (item.pendingExpiresAtMs ?? 0) > nowMs) {
    return { kind: 'pending', reservationId: item.reservationId, marker: item.marker }
  }
  if (item.status === 'reconciling') {
    return { kind: 'reconciling', reservationId: item.reservationId, marker: item.marker, rateClaim: item.rateClaim }
  }
  return null
}

function repositoryError(error: unknown): unknown {
  const code = statusCode(error)
  if (code === undefined || code === 408 || code === 429 || code >= 500) {
    return new ExamRequestRepositoryUnavailableError()
  }
  return error
}

class AzureExamRequestContainerBoundary implements ExamRequestContainerBoundary {
  constructor(private readonly container: Container) {}

  async read(id: string, partitionKey: string): Promise<StoredResource> {
    const response = await this.container.item(id, partitionKey).read()
    return { resource: response.resource, etag: response.etag }
  }

  async create(resource: Record<string, unknown>): Promise<StoredResource> {
    const response = await this.container.items.create(resource as JSONObject)
    return { resource: response.resource, etag: response.etag }
  }

  async replace(resource: Record<string, unknown>, partitionKey: string, ifMatch: string): Promise<StoredResource> {
    const response = await this.container.item(String(resource.id), partitionKey).replace(resource as JSONObject, {
      accessCondition: { type: 'IfMatch', condition: ifMatch },
    })
    return { resource: response.resource, etag: response.etag }
  }
}

/**
 * Uses a container partitioned by /id. Durable per-exam records intentionally omit `ttl`.
 * Idempotency and rate records always carry a positive per-item `ttl`; the container must use
 * `defaultTtl = -1` so only those ephemeral records expire. Every update to a durable record or
 * rate counter is protected by the provider ETag.
 */
export class CosmosExamRequestRepository implements ExamRequestRepository {
  constructor(private readonly container: ExamRequestContainerBoundary) {}

  static fromConfiguration(configuration: CosmosExamRequestRepositoryConfiguration): CosmosExamRequestRepository {
    const client = configuration.connectionString
      ? new CosmosClient(configuration.connectionString)
      : new CosmosClient({
          endpoint: configuration.endpoint ?? '',
          aadCredentials: new DefaultAzureCredential(),
        })
    return new CosmosExamRequestRepository(
      new AzureExamRequestContainerBoundary(client.database(configuration.databaseId).container(configuration.containerId)),
    )
  }

  async reserve(examCode: string, idempotencyKey: string, nowMs: number, pendingTtlSeconds: number): Promise<ExamReservation> {
    const reservationId = idempotencyKey
    let marker = randomBytes(32).toString('hex')
    const receipt: IdempotencyItem = {
      id: idempotencyId(idempotencyKey),
      type: 'idempotency',
      examCode,
      reservationId,
      marker,
      createdAtMs: nowMs,
      ttl: Math.max(pendingTtlSeconds * 5, 600),
    }
    let receiptCreated = false
    try {
      await this.container.create(receipt as unknown as Record<string, unknown>)
      receiptCreated = true
    } catch (error) {
      if (statusCode(error) !== 409) throw repositoryError(error)
      const existing = await this.readItem<IdempotencyItem>(receipt.id)
      if (!existing || existing.resource.examCode !== examCode) throw new ExamRequestRepositoryConflictError()
      marker = existing.resource.marker
    }

    const id = examId(examCode)
    let pending = this.pendingItem(examCode, idempotencyKey, reservationId, marker, nowMs, pendingTtlSeconds)
    if (receiptCreated) {
      try {
        await this.container.create(pending as unknown as Record<string, unknown>)
        return { kind: 'acquired', reservationId, marker, staleTakeover: false }
      } catch (error) {
        if (statusCode(error) !== 409) throw repositoryError(error)
      }
    }

    const current = await this.readItem<ExamItem>(id)
    if (!current) {
      // A prior attempt may have created the receipt and failed before creating the exam record.
      // Retrying the same key repairs that orphan without rebinding the receipt.
      try {
        await this.container.create(pending as unknown as Record<string, unknown>)
        return { kind: 'acquired', reservationId, marker, staleTakeover: false }
      } catch (error) {
        if (statusCode(error) !== 409) throw repositoryError(error)
        const winner = await this.readItem<ExamItem>(id)
        return winner ? (asReservation(winner.resource, nowMs) ?? { kind: 'pending', reservationId: winner.resource.reservationId, marker: winner.resource.marker }) : { kind: 'pending', reservationId, marker }
      }
    }
    const visible = asReservation(current.resource, nowMs)
    if (visible) return visible

    marker = current.resource.marker ?? marker
    pending = this.pendingItem(examCode, idempotencyKey, reservationId, marker, nowMs, pendingTtlSeconds)

    try {
      await this.container.replace(pending as unknown as Record<string, unknown>, id, current.etag)
      return { kind: 'acquired', reservationId, marker, staleTakeover: true }
    } catch (error) {
      if (statusCode(error) !== 412) throw repositoryError(error)
      const winner = await this.readItem<ExamItem>(id)
      return winner ? (asReservation(winner.resource, nowMs) ?? { kind: 'pending', reservationId: winner.resource.reservationId, marker: winner.resource.marker }) : { kind: 'pending', reservationId, marker }
    }
  }

  async read(examCode: string, nowMs: number): Promise<ExamReservation | null> {
    const current = await this.readItem<ExamItem>(examId(examCode))
    return current ? asReservation(current.resource, nowMs) : null
  }

  async acquireReplacement(
    examCode: string,
    idempotencyKey: string,
    expectedIssueNumber: number,
    nowMs: number,
    pendingTtlSeconds: number,
  ): Promise<ExamReservation> {
    const id = examId(examCode)
    const current = await this.readItem<ExamItem>(id)
    if (!current) throw new ExamRequestRepositoryConflictError()
    if (current.resource.status !== 'completed' || current.resource.issue?.number !== expectedIssueNumber) {
      return asReservation(current.resource, nowMs) ?? { kind: 'pending', reservationId: current.resource.reservationId, marker: current.resource.marker }
    }
    const pending = this.pendingItem(examCode, idempotencyKey, idempotencyKey, current.resource.marker, nowMs, pendingTtlSeconds)
    try {
      await this.container.replace(pending as unknown as Record<string, unknown>, id, current.etag)
      return { kind: 'acquired', reservationId: idempotencyKey, marker: current.resource.marker, staleTakeover: false }
    } catch (error) {
      if (statusCode(error) !== 412) throw repositoryError(error)
      const winner = await this.readItem<ExamItem>(id)
      return winner ? (asReservation(winner.resource, nowMs) ?? { kind: 'pending', reservationId: winner.resource.reservationId, marker: winner.resource.marker }) : { kind: 'pending', reservationId: idempotencyKey, marker: current.resource.marker }
    }
  }

  async complete(examCode: string, reservationId: string, issue: ExamRequestIssue, nowMs: number): Promise<void> {
    const current = await this.ownedInProgress(examCode, reservationId)
    const completed: ExamItem = {
      id: examId(examCode),
      type: 'exam',
      examCode,
      status: 'completed',
      reservationId,
      marker: current.resource.marker,
      idempotencyKey: current.resource.idempotencyKey,
      updatedAtMs: nowMs,
      issue,
    }
    try {
      await this.container.replace(completed as unknown as Record<string, unknown>, completed.id, current.etag)
    } catch (error) {
      if (statusCode(error) === 412) throw new ExamRequestRepositoryConflictError()
      throw repositoryError(error)
    }
  }

  async beginIssueCreation(
    examCode: string,
    reservationId: string,
    rateClaim: RateLimitClaim | undefined,
    nowMs: number,
  ): Promise<void> {
    const current = await this.ownedInProgress(examCode, reservationId)
    const persistedRateClaim = rateClaim ?? current.resource.rateClaim
    const reconciling: ExamItem = {
      id: examId(examCode),
      type: 'exam',
      examCode,
      status: 'reconciling',
      reservationId,
      marker: current.resource.marker,
      idempotencyKey: current.resource.idempotencyKey,
      ...(persistedRateClaim ? { rateClaim: persistedRateClaim } : {}),
      updatedAtMs: nowMs,
    }
    try {
      await this.container.replace(reconciling as unknown as Record<string, unknown>, reconciling.id, current.etag)
    } catch (error) {
      if (statusCode(error) === 412) throw new ExamRequestRepositoryConflictError()
      throw repositoryError(error)
    }
  }

  async release(examCode: string, reservationId: string, nowMs: number): Promise<void> {
    const current = await this.ownedInProgress(examCode, reservationId)
    const retryable: ExamItem = {
      id: examId(examCode),
      type: 'exam',
      examCode,
      status: 'retryable',
      reservationId,
      marker: current.resource.marker,
      idempotencyKey: current.resource.idempotencyKey,
      updatedAtMs: nowMs,
    }
    try {
      await this.container.replace(retryable as unknown as Record<string, unknown>, retryable.id, current.etag)
    } catch (error) {
      if (statusCode(error) === 412) throw new ExamRequestRepositoryConflictError()
      throw repositoryError(error)
    }
  }

  async claimRateLimit(
    key: string,
    claimId: string,
    nowMs: number,
    ttlSeconds: number,
    claimTtlSeconds: number,
    limit: number,
  ): Promise<boolean> {
    return this.updateRateItem(key, nowMs, ttlSeconds, (item) => {
      const claims = this.activeClaims(item.claims, nowMs)
      if (item.finalizedClaimIds.includes(claimId) || Object.hasOwn(claims, claimId)) return { item: { ...item, claims }, result: true }
      if (item.count + Object.keys(claims).length >= limit) return { item: { ...item, claims }, result: false }
      claims[claimId] = nowMs + claimTtlSeconds * 1_000
      return { item: { ...item, claims }, result: true }
    })
  }

  async finalizeRateLimit(claim: RateLimitClaim, nowMs: number, ttlSeconds: number): Promise<void> {
    await this.updateRateItem(claim.key, nowMs, ttlSeconds, (item) => {
      const claims = this.activeClaims(item.claims, nowMs)
      delete claims[claim.claimId]
      if (item.finalizedClaimIds.includes(claim.claimId)) return { item: { ...item, claims }, result: undefined }
      return {
        item: { ...item, count: item.count + 1, claims, finalizedClaimIds: [...item.finalizedClaimIds, claim.claimId] },
        result: undefined,
      }
    })
  }

  async releaseRateLimit(claim: RateLimitClaim, nowMs: number, ttlSeconds: number): Promise<void> {
    await this.updateRateItem(claim.key, nowMs, ttlSeconds, (item) => {
      const claims = this.activeClaims(item.claims, nowMs)
      delete claims[claim.claimId]
      return { item: { ...item, claims }, result: undefined }
    })
  }

  private pendingItem(
    examCode: string,
    idempotencyKey: string,
    reservationId: string,
    marker: string,
    nowMs: number,
    pendingTtlSeconds: number,
  ): ExamItem {
    return {
      id: examId(examCode),
      type: 'exam',
      examCode,
      status: 'pending',
      reservationId,
      marker,
      idempotencyKey,
      pendingExpiresAtMs: nowMs + pendingTtlSeconds * 1_000,
      updatedAtMs: nowMs,
    }
  }

  private async ownedInProgress(examCode: string, reservationId: string): Promise<{ resource: ExamItem; etag: string }> {
    const current = await this.readItem<ExamItem>(examId(examCode))
    if (!current || !['pending', 'reconciling'].includes(current.resource.status) || current.resource.reservationId !== reservationId) {
      throw new ExamRequestRepositoryConflictError()
    }
    return current
  }

  private activeClaims(claims: Record<string, number> | undefined, nowMs: number): Record<string, number> {
    return Object.fromEntries(Object.entries(claims ?? {}).filter(([, expiresAtMs]) => expiresAtMs > nowMs))
  }

  private async updateRateItem<T>(
    key: string,
    nowMs: number,
    ttlSeconds: number,
    update: (item: RateItem) => { item: RateItem; result: T },
  ): Promise<T> {
    for (let attempt = 0; attempt < RATE_UPDATE_ATTEMPTS; attempt += 1) {
      const current = await this.readItem<RateItem>(key)
      const base: RateItem = current?.resource ?? {
        id: key, type: 'rate', count: 0, claims: {}, finalizedClaimIds: [], updatedAtMs: nowMs, ttl: ttlSeconds,
      }
      const changed = update({ ...base, claims: base.claims ?? {}, finalizedClaimIds: base.finalizedClaimIds ?? [] })
      const resource = { ...changed.item, updatedAtMs: nowMs, ttl: ttlSeconds }
      try {
        if (current) await this.container.replace(resource as unknown as Record<string, unknown>, key, current.etag)
        else await this.container.create(resource as unknown as Record<string, unknown>)
        return changed.result
      } catch (error) {
        const expectedConflict = current ? statusCode(error) === 412 : statusCode(error) === 409
        if (!expectedConflict) throw repositoryError(error)
      }
    }
    throw new ExamRequestRepositoryUnavailableError()
  }

  private async readItem<T>(id: string): Promise<{ resource: T; etag: string } | null> {
    try {
      const response = await this.container.read(id, id)
      if (!response.resource || !response.etag) return null
      return { resource: response.resource as T, etag: response.etag }
    } catch (error) {
      if (statusCode(error) === 404) return null
      throw repositoryError(error)
    }
  }
}