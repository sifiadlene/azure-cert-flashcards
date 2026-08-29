import type { ExamRequestIssue, ExamReservation, RateLimitClaim } from '../domain/examRequests'

export interface ExamRequestRepository {
  reserve(examCode: string, idempotencyKey: string, nowMs: number, pendingTtlSeconds: number): Promise<ExamReservation>
  read(examCode: string, nowMs: number): Promise<ExamReservation | null>
  acquireReplacement(
    examCode: string,
    idempotencyKey: string,
    expectedIssueNumber: number,
    nowMs: number,
    pendingTtlSeconds: number,
  ): Promise<ExamReservation>
  complete(examCode: string, reservationId: string, issue: ExamRequestIssue, nowMs: number): Promise<void>
  beginIssueCreation(
    examCode: string,
    reservationId: string,
    rateClaim: RateLimitClaim | undefined,
    nowMs: number,
  ): Promise<void>
  release(examCode: string, reservationId: string, nowMs: number): Promise<void>
  claimRateLimit(key: string, claimId: string, nowMs: number, ttlSeconds: number, claimTtlSeconds: number, limit: number): Promise<boolean>
  finalizeRateLimit(claim: RateLimitClaim, nowMs: number, ttlSeconds: number): Promise<void>
  releaseRateLimit(claim: RateLimitClaim, nowMs: number, ttlSeconds: number): Promise<void>
}

export interface TurnstileVerifier {
  verify(token: string, idempotencyKey: string, remoteIp?: string): Promise<void>
}

export interface GitHubIssues {
  getIssueState(issueNumber: number): Promise<'open' | 'closed'>
  findOpenExamRequest(marker: string): Promise<ExamRequestIssue | null>
  createExamRequest(input: { code: string; title: string; sourceUrl: string; marker: string }): Promise<ExamRequestIssue>
}

export interface ExamRequestTelemetry {
  track(name: string, properties: Readonly<{ examCode: string; traceId: string }>): void
}

export const NOOP_EXAM_REQUEST_TELEMETRY: ExamRequestTelemetry = {
  track: () => undefined,
}