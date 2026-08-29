export interface ExamRequestIssue {
  number: number
  url: string
}

export interface RateLimitClaim {
  key: string
  claimId: string
}

export type ExamReservation =
  | { kind: 'acquired'; reservationId: string; marker: string; staleTakeover: boolean }
  | { kind: 'pending'; reservationId: string; marker: string }
  | { kind: 'reconciling'; reservationId: string; marker: string; rateClaim?: RateLimitClaim }
  | { kind: 'completed'; reservationId: string; marker: string; issue: ExamRequestIssue }

export type ExamRequestErrorKind =
  | 'validation'
  | 'supported'
  | 'turnstileRejected'
  | 'rateLimited'
  | 'turnstileUnavailable'
  | 'githubUnavailable'
  | 'githubFailed'
  | 'repositoryUnavailable'
  | 'pending'
  | 'internal'

export class ExamRequestApplicationError extends Error {
  constructor(
    readonly kind: ExamRequestErrorKind,
    readonly retryable: boolean,
    readonly retryAfterSeconds?: number,
    readonly issues?: ReadonlyArray<{ field: string; code: string; message: string }>,
  ) {
    super(kind)
    this.name = 'ExamRequestApplicationError'
  }
}

export class TurnstileRejectedError extends Error {
  constructor() {
    super('Turnstile rejected the request.')
    this.name = 'TurnstileRejectedError'
  }
}

export class TurnstileUnavailableError extends Error {
  constructor() {
    super('Turnstile verification is unavailable.')
    this.name = 'TurnstileUnavailableError'
  }
}

export class GitHubUpstreamError extends Error {
  constructor(readonly retryable: boolean, readonly outcomeUnknown = false) {
    super('GitHub request failed.')
    this.name = 'GitHubUpstreamError'
  }
}

export class ExamRequestRepositoryConflictError extends Error {
  constructor() {
    super('The exam request was modified concurrently.')
    this.name = 'ExamRequestRepositoryConflictError'
  }
}

export class ExamRequestRepositoryUnavailableError extends Error {
  constructor() {
    super('The exam request repository is unavailable.')
    this.name = 'ExamRequestRepositoryUnavailableError'
  }
}