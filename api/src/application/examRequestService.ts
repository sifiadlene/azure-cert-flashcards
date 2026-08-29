import { createHmac } from 'node:crypto'
import type { ExamCatalog, ExamCatalogEntry } from './examCatalog'
import type {
  ExamRequestRepository,
  ExamRequestTelemetry,
  GitHubIssues,
  TurnstileVerifier,
} from './examRequestPorts'
import { NOOP_EXAM_REQUEST_TELEMETRY } from './examRequestPorts'
import {
  ExamRequestApplicationError,
  ExamRequestRepositoryConflictError,
  ExamRequestRepositoryUnavailableError,
  GitHubUpstreamError,
  TurnstileRejectedError,
  TurnstileUnavailableError,
  type ExamRequestIssue,
  type ExamReservation,
  type RateLimitClaim,
} from '../domain/examRequests'

const DAY_MS = 86_400_000

export interface ExamRequestServiceOptions {
  pendingTtlSeconds?: number
  pendingWaitMs?: number
  pendingPollMs?: number
  rateLimit?: number
  rateRecordTtlSeconds?: number
  rateClaimTtlSeconds?: number
  wait?: (delayMs: number) => Promise<void>
}

export interface SubmitExamRequestInput {
  examCode: string
  idempotencyKey: string
  turnstileToken: string
  remoteIp?: string
  traceId: string
  nowMs: number
}

export interface SubmitExamRequestResult extends ExamRequestIssue {
  reused: boolean
}

function delay(delayMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, delayMs))
}

export class ExamRequestService {
  private readonly pendingTtlSeconds: number
  private readonly pendingWaitMs: number
  private readonly pendingPollMs: number
  private readonly rateLimit: number
  private readonly rateRecordTtlSeconds: number
  private readonly rateClaimTtlSeconds: number
  private readonly wait: (delayMs: number) => Promise<void>

  constructor(
    private readonly catalog: ExamCatalog,
    private readonly repository: ExamRequestRepository,
    private readonly turnstile: TurnstileVerifier,
    private readonly github: GitHubIssues,
    private readonly ipHashKey: Buffer,
    private readonly telemetry: ExamRequestTelemetry = NOOP_EXAM_REQUEST_TELEMETRY,
    options: ExamRequestServiceOptions = {},
  ) {
    if (ipHashKey.byteLength < 32) throw new Error('The exam-request IP hash key must be at least 32 bytes.')
    this.pendingTtlSeconds = options.pendingTtlSeconds ?? 120
    this.pendingWaitMs = options.pendingWaitMs ?? 4_000
    this.pendingPollMs = options.pendingPollMs ?? 100
    this.rateLimit = options.rateLimit ?? 3
    this.rateRecordTtlSeconds = options.rateRecordTtlSeconds ?? 172_800
    this.rateClaimTtlSeconds = options.rateClaimTtlSeconds ?? Math.max(this.pendingTtlSeconds * 2, 300)
    this.wait = options.wait ?? delay
  }

  async submit(input: SubmitExamRequestInput): Promise<SubmitExamRequestResult> {
    const properties = { examCode: input.examCode, traceId: input.traceId }
    const exam = this.validateExam(input.examCode)
    const reservation = await this.repositoryCall(() => this.repository.reserve(
      exam.code,
      input.idempotencyKey,
      input.nowMs,
      this.pendingTtlSeconds,
    ))

    if (reservation.kind === 'pending') {
      const completed = await this.waitForWinner(exam.code, input.nowMs)
      if (completed) {
        this.telemetry.track('exam_request.reused', properties)
        return { ...completed, reused: true }
      }
      this.telemetry.track('exam_request.stale_pending', properties)
      throw new ExamRequestApplicationError('pending', true, 2)
    }

    if (reservation.kind === 'reconciling') {
      return this.reconcileUnknownOutcome(exam, input, reservation)
    }

    if (reservation.kind === 'acquired' && reservation.staleTakeover) {
      this.telemetry.track('exam_request.stale_pending', properties)
    }

    try {
      await this.turnstile.verify(input.turnstileToken, input.idempotencyKey, input.remoteIp)
    } catch (error) {
      if (reservation.kind === 'acquired') await this.releaseBestEffort(exam.code, reservation.reservationId, input.nowMs)
      if (error instanceof TurnstileRejectedError) {
        this.telemetry.track('exam_request.rejected', properties)
        throw new ExamRequestApplicationError('turnstileRejected', false)
      }
      this.telemetry.track('exam_request.turnstile_failed', properties)
      if (error instanceof TurnstileUnavailableError) {
        throw new ExamRequestApplicationError('turnstileUnavailable', true, 2)
      }
      throw error
    }

    if (reservation.kind === 'completed') {
      return this.reuseOrReplace(exam, input, reservation)
    }

    return this.createIssue(exam, input, reservation.reservationId, reservation.marker)
  }

  private validateExam(code: string): ExamCatalogEntry {
    const exam = this.catalog.find(code)
    if (!exam) {
      throw new ExamRequestApplicationError('validation', false, undefined, [{
        field: 'examCode', code: 'invalidValue', message: 'The selected exam is not requestable.',
      }])
    }
    if (this.catalog.isSupported(code)) throw new ExamRequestApplicationError('supported', false)
    return exam
  }

  private async reuseOrReplace(
    exam: ExamCatalogEntry,
    input: SubmitExamRequestInput,
    reservation: Extract<ExamReservation, { kind: 'completed' }>,
  ): Promise<SubmitExamRequestResult> {
    const properties = { examCode: exam.code, traceId: input.traceId }
    try {
      if (await this.github.getIssueState(reservation.issue.number) === 'open') {
        this.telemetry.track('exam_request.reused', properties)
        return { ...reservation.issue, reused: true }
      }
    } catch (error) {
      this.telemetry.track('exam_request.github_failed', properties)
      throw this.githubError(error)
    }

    const replacement = await this.repositoryCall(() => this.repository.acquireReplacement(
      exam.code,
      input.idempotencyKey,
      reservation.issue.number,
      input.nowMs,
      this.pendingTtlSeconds,
    ))
    if (replacement.kind === 'completed') {
      this.telemetry.track('exam_request.reused', properties)
      return { ...replacement.issue, reused: true }
    }
    if (replacement.kind === 'pending') {
      const completed = await this.waitForWinner(exam.code, input.nowMs)
      if (completed) return { ...completed, reused: true }
      this.telemetry.track('exam_request.stale_pending', properties)
      throw new ExamRequestApplicationError('pending', true, 2)
    }
    if (replacement.kind === 'reconciling') return this.reconcileUnknownOutcome(exam, input, replacement)
    return this.createIssue(exam, input, replacement.reservationId, replacement.marker)
  }

  private async createIssue(
    exam: ExamCatalogEntry,
    input: SubmitExamRequestInput,
    reservationId: string,
    marker: string,
  ): Promise<SubmitExamRequestResult> {
    const properties = { examCode: exam.code, traceId: input.traceId }
    let reconciled: ExamRequestIssue | null
    try {
      reconciled = await this.github.findOpenExamRequest(marker)
    } catch (error) {
      await this.releaseBestEffort(exam.code, reservationId, input.nowMs)
      this.telemetry.track('exam_request.github_failed', properties)
      throw this.githubError(error)
    }
    if (reconciled) {
      await this.completeOrReconcile(exam.code, reservationId, reconciled, undefined, input.nowMs)
      this.telemetry.track('exam_request.reused', properties)
      return { ...reconciled, reused: true }
    }

    let rateClaim: RateLimitClaim | undefined
    if (input.remoteIp) {
      const day = Math.floor(input.nowMs / DAY_MS)
      const digest = createHmac('sha256', this.ipHashKey).update(input.remoteIp).digest('base64url')
      const claim = { key: `rate:${day}:${digest}`, claimId: `${exam.code}:${reservationId}` }
      rateClaim = claim
      const accepted = await this.repositoryCall(() => this.repository.claimRateLimit(
        claim.key,
        claim.claimId,
        input.nowMs,
        this.rateRecordTtlSeconds,
        this.rateClaimTtlSeconds,
        this.rateLimit,
      ))
      if (!accepted) {
        await this.releaseBestEffort(exam.code, reservationId, input.nowMs)
        const retryAfter = Math.max(1, Math.ceil(((day + 1) * DAY_MS - input.nowMs) / 1_000))
        this.telemetry.track('exam_request.rate_limited', properties)
        throw new ExamRequestApplicationError('rateLimited', true, retryAfter)
      }
    }

    try {
      await this.repositoryCall(() => this.repository.beginIssueCreation(exam.code, reservationId, rateClaim, input.nowMs))
    } catch (error) {
      await this.releaseRateBestEffort(rateClaim, input.nowMs)
      await this.releaseBestEffort(exam.code, reservationId, input.nowMs)
      throw error
    }

    let issue: ExamRequestIssue
    try {
      issue = await this.github.createExamRequest({ ...exam, marker })
    } catch (error) {
      if (!(error instanceof GitHubUpstreamError && error.outcomeUnknown)) {
        await this.releaseRateBestEffort(rateClaim, input.nowMs)
        await this.releaseBestEffort(exam.code, reservationId, input.nowMs)
      }
      this.telemetry.track('exam_request.github_failed', properties)
      throw this.githubError(error)
    }

    try {
      if (rateClaim) {
        await this.repositoryCall(() => this.repository.finalizeRateLimit(rateClaim, input.nowMs, this.rateRecordTtlSeconds))
      }
      await this.repositoryCall(() => this.repository.complete(exam.code, reservationId, issue, input.nowMs))
    } catch (error) {
      this.telemetry.track('exam_request.github_failed', properties)
      throw error
    }
    this.telemetry.track('exam_request.accepted', properties)
    return { ...issue, reused: false }
  }

  private async reconcileUnknownOutcome(
    exam: ExamCatalogEntry,
    input: SubmitExamRequestInput,
    reservation: Extract<ExamReservation, { kind: 'reconciling' }>,
  ): Promise<SubmitExamRequestResult> {
    const properties = { examCode: exam.code, traceId: input.traceId }
    let issue: ExamRequestIssue | null
    try {
      issue = await this.github.findOpenExamRequest(reservation.marker)
    } catch (error) {
      this.telemetry.track('exam_request.github_failed', properties)
      throw this.githubError(error)
    }
    if (!issue) {
      this.telemetry.track('exam_request.stale_pending', properties)
      throw new ExamRequestApplicationError('pending', true, 2)
    }
    await this.completeOrReconcile(exam.code, reservation.reservationId, issue, reservation.rateClaim, input.nowMs)
    this.telemetry.track('exam_request.reused', properties)
    return { ...issue, reused: true }
  }

  private async completeOrReconcile(
    examCode: string,
    reservationId: string,
    issue: ExamRequestIssue,
    rateClaim: RateLimitClaim | undefined,
    nowMs: number,
  ): Promise<void> {
    if (rateClaim) await this.repositoryCall(() => this.repository.finalizeRateLimit(rateClaim, nowMs, this.rateRecordTtlSeconds))
    await this.repositoryCall(() => this.repository.complete(examCode, reservationId, issue, nowMs))
  }

  private async waitForWinner(examCode: string, nowMs: number): Promise<ExamRequestIssue | null> {
    const attempts = Math.max(1, Math.ceil(this.pendingWaitMs / this.pendingPollMs))
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      await this.wait(this.pendingPollMs)
      const current = await this.repositoryCall(() => this.repository.read(examCode, nowMs + (attempt + 1) * this.pendingPollMs))
      if (current?.kind === 'completed') return current.issue
      if (!current || current.kind === 'acquired') return null
    }
    return null
  }

  private async releaseBestEffort(examCode: string, reservationId: string, nowMs: number): Promise<void> {
    try {
      await this.repository.release(examCode, reservationId, nowMs)
    } catch {
      // The durable pending timestamp permits a later request to recover this reservation.
    }
  }

  private async releaseRateBestEffort(claim: RateLimitClaim | undefined, nowMs: number): Promise<void> {
    if (!claim) return
    try {
      await this.repository.releaseRateLimit(claim, nowMs, this.rateRecordTtlSeconds)
    } catch {
      // Expiring claims are pruned by later claim attempts.
    }
  }

  private async repositoryCall<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation()
    } catch (error) {
      if (error instanceof ExamRequestRepositoryConflictError || error instanceof ExamRequestRepositoryUnavailableError) {
        throw new ExamRequestApplicationError('repositoryUnavailable', true, 2)
      }
      throw error
    }
  }

  private githubError(error: unknown): ExamRequestApplicationError {
    if (error instanceof ExamRequestApplicationError) return error
    if (error instanceof GitHubUpstreamError) {
      return new ExamRequestApplicationError(error.retryable ? 'githubUnavailable' : 'githubFailed', error.retryable, error.retryable ? 2 : undefined)
    }
    return new ExamRequestApplicationError('githubUnavailable', true, 2)
  }
}