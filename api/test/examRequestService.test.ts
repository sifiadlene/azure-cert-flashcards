import { describe, expect, it, vi } from 'vitest'
import { ExamCatalog } from '../src/application/examCatalog'
import type { ExamRequestRepository, ExamRequestTelemetry, GitHubIssues, TurnstileVerifier } from '../src/application/examRequestPorts'
import { ExamRequestService } from '../src/application/examRequestService'
import {
  ExamRequestRepositoryUnavailableError,
  GitHubUpstreamError,
  TurnstileRejectedError,
  TurnstileUnavailableError,
  type ExamRequestIssue,
  type ExamReservation,
} from '../src/domain/examRequests'

const exam = {
  code: 'AB-730',
  title: 'AI Business Professional',
  sourceUrl: 'https://learn.microsoft.com/ab-730',
  sourcePageUrl: 'https://learn.microsoft.com/catalog',
  retrievedAt: '2026-08-29T00:00:00.000Z',
}

function catalog(): ExamCatalog {
  return new ExamCatalog(
    { schemaVersion: 1, exams: [exam, { ...exam, code: 'AB-100' }, { ...exam, code: 'AB-731' }] },
    { schemaVersion: 1, codes: ['AB-100'] },
  )
}

class FakeRepository implements ExamRequestRepository {
  current?: ExamReservation
  rateAllowed = true
  completeFailures = 0
  readonly rateKeys: string[] = []
  readonly finalizedClaims: string[] = []
  readonly releasedClaims: string[] = []
  readonly completions: ExamRequestIssue[] = []
  readonly releases: string[] = []

  async reserve(_examCode: string, idempotencyKey: string): Promise<ExamReservation> {
    if (!this.current) {
      this.current = { kind: 'acquired', reservationId: idempotencyKey, marker: 'server-marker', staleTakeover: false }
      return this.current
    }
    if (this.current.kind === 'acquired') return { kind: 'pending', reservationId: this.current.reservationId, marker: this.current.marker }
    return this.current
  }

  async read(): Promise<ExamReservation | null> {
    return this.current?.kind === 'acquired'
      ? { kind: 'pending', reservationId: this.current.reservationId, marker: this.current.marker }
      : this.current ?? null
  }

  async acquireReplacement(_examCode: string, idempotencyKey: string): Promise<ExamReservation> {
    const marker = this.current?.marker ?? 'server-marker'
    this.current = { kind: 'acquired', reservationId: idempotencyKey, marker, staleTakeover: false }
    return this.current
  }

  async complete(_examCode: string, reservationId: string, issue: ExamRequestIssue): Promise<void> {
    if (this.completeFailures > 0) {
      this.completeFailures -= 1
      throw new ExamRequestRepositoryUnavailableError()
    }
    this.completions.push(issue)
    this.current = { kind: 'completed', reservationId, marker: this.current?.marker ?? 'server-marker', issue }
  }

  async beginIssueCreation(
    _examCode: string,
    reservationId: string,
    rateClaim?: { key: string; claimId: string },
  ): Promise<void> {
    this.current = { kind: 'reconciling', reservationId, marker: this.current?.marker ?? 'server-marker', rateClaim }
  }

  async release(_examCode: string, reservationId: string): Promise<void> {
    this.releases.push(reservationId)
    if (this.current?.reservationId === reservationId) this.current = undefined
  }

  async claimRateLimit(key: string): Promise<boolean> {
    this.rateKeys.push(key)
    return this.rateAllowed
  }

  async finalizeRateLimit(claim: { claimId: string }): Promise<void> {
    this.finalizedClaims.push(claim.claimId)
  }

  async releaseRateLimit(claim: { claimId: string }): Promise<void> {
    this.releasedClaims.push(claim.claimId)
  }
}

function input(overrides: Partial<Parameters<ExamRequestService['submit']>[0]> = {}) {
  return {
    examCode: 'AB-730',
    idempotencyKey: '48e228f6-c629-46d4-bb37-00510cfbc274',
    turnstileToken: 'turnstile-secret-token',
    remoteIp: '203.0.113.7',
    traceId: 'trace-1',
    nowMs: Date.parse('2026-08-29T12:00:00Z'),
    ...overrides,
  }
}

function setup(options: {
  repository?: FakeRepository
  turnstile?: TurnstileVerifier
  github?: GitHubIssues
  telemetry?: ExamRequestTelemetry
  wait?: () => Promise<void>
} = {}) {
  const repository = options.repository ?? new FakeRepository()
  const turnstile = options.turnstile ?? { verify: vi.fn().mockResolvedValue(undefined) }
  const github = options.github ?? {
    getIssueState: vi.fn().mockResolvedValue('open'),
    findOpenExamRequest: vi.fn().mockResolvedValue(null),
    createExamRequest: vi.fn().mockResolvedValue({ number: 42, url: 'https://github.com/sifiadlene/azure-cert-flashcards/issues/42' }),
  }
  const telemetry = options.telemetry ?? { track: vi.fn() }
  const service = new ExamRequestService(
    catalog(), repository, turnstile, github, Buffer.alloc(32, 9), telemetry,
    { pendingWaitMs: 20, pendingPollMs: 1, wait: options.wait },
  )
  return { service, repository, turnstile, github, telemetry }
}

describe('ExamRequestService', () => {
  it('rejects stale selections and authoritative supported exams before upstream calls', async () => {
    const { service, turnstile } = setup()
    await expect(service.submit(input({ examCode: 'ZZ-999' }))).rejects.toMatchObject({ kind: 'validation' })
    await expect(service.submit(input({ examCode: 'AB-100' }))).rejects.toMatchObject({ kind: 'supported' })
    expect(turnstile.verify).not.toHaveBeenCalled()
  })

  it('creates an issue from server catalog data and emits only safe telemetry dimensions', async () => {
    const { service, github, repository, telemetry } = setup()
    await expect(service.submit(input())).resolves.toEqual({
      number: 42,
      url: 'https://github.com/sifiadlene/azure-cert-flashcards/issues/42',
      reused: false,
    })
    expect(github.createExamRequest).toHaveBeenCalledWith(expect.objectContaining({
      ...exam,
      marker: 'server-marker',
    }))
    expect(repository.completions).toHaveLength(1)
    expect(repository.finalizedClaims).toEqual([`AB-730:${input().idempotencyKey}`])
    expect(telemetry.track).toHaveBeenCalledWith('exam_request.accepted', { examCode: 'AB-730', traceId: 'trace-1' })
    const emitted = JSON.stringify((telemetry.track as ReturnType<typeof vi.fn>).mock.calls)
    expect(emitted).not.toContain('203.0.113.7')
    expect(emitted).not.toContain('turnstile-secret-token')
  })

  it.each([
    [new TurnstileRejectedError(), 'turnstileRejected', false],
    [new TurnstileUnavailableError(), 'turnstileUnavailable', true],
  ] as const)('releases reservations and maps Turnstile outcomes', async (failure, kind, retryable) => {
    const turnstile = { verify: vi.fn().mockRejectedValue(failure) }
    const { service, repository } = setup({ turnstile })
    await expect(service.submit(input())).rejects.toMatchObject({ kind, retryable })
    expect(repository.releases).toEqual([input().idempotencyKey])
  })

  it('HMAC-hashes the address, enforces the UTC-day limit, and returns boundary Retry-After', async () => {
    const repository = new FakeRepository()
    repository.rateAllowed = false
    const { service } = setup({ repository })
    const nowMs = Date.parse('2026-08-29T23:59:59.500Z')
    await expect(service.submit(input({ nowMs }))).rejects.toMatchObject({
      kind: 'rateLimited', retryAfterSeconds: 1,
    })
    expect(repository.rateKeys[0]).toMatch(/^rate:\d+:[A-Za-z0-9_-]{43}$/)
    expect(repository.rateKeys[0]).not.toContain('203.0.113.7')
  })

  it('checks stored issues live, reuses only open issues, and replaces closed issues', async () => {
    const openRepository = new FakeRepository()
    openRepository.current = { kind: 'completed', reservationId: 'old', marker: 'server-marker', issue: { number: 10, url: 'https://github.com/issue/10' } }
    const openGithub = { getIssueState: vi.fn().mockResolvedValue('open'), findOpenExamRequest: vi.fn(), createExamRequest: vi.fn() }
    const open = setup({ repository: openRepository, github: openGithub })
    await expect(open.service.submit(input())).resolves.toEqual({ number: 10, url: 'https://github.com/issue/10', reused: true })
    expect(openGithub.createExamRequest).not.toHaveBeenCalled()
    expect(openRepository.rateKeys).toHaveLength(0)

    const closedRepository = new FakeRepository()
    closedRepository.current = { kind: 'completed', reservationId: 'old', marker: 'server-marker', issue: { number: 10, url: 'https://github.com/issue/10' } }
    const closedGithub = {
      getIssueState: vi.fn().mockResolvedValue('closed'),
      findOpenExamRequest: vi.fn().mockResolvedValue(null),
      createExamRequest: vi.fn().mockResolvedValue({ number: 11, url: 'https://github.com/issue/11' }),
    }
    const closed = setup({ repository: closedRepository, github: closedGithub })
    await expect(closed.service.submit(input())).resolves.toEqual({ number: 11, url: 'https://github.com/issue/11', reused: false })
    expect(closedRepository.rateKeys).toHaveLength(1)
  })

  it('makes concurrent requests wait on one reservation, one Turnstile redemption, and one issue creation', async () => {
    let releaseIssue: (() => void) | undefined
    const issueGate = new Promise<void>((resolve) => { releaseIssue = resolve })
    const github = {
      getIssueState: vi.fn().mockResolvedValue('open'),
      findOpenExamRequest: vi.fn().mockResolvedValue(null),
      createExamRequest: vi.fn(async () => {
        await issueGate
        return { number: 42, url: 'https://github.com/issue/42' }
      }),
    }
    const wait = async () => { await new Promise<void>((resolve) => setImmediate(resolve)) }
    const { service, turnstile } = setup({ github, wait })
    const first = service.submit(input())
    while (github.createExamRequest.mock.calls.length === 0) await wait()
    const second = service.submit(input())
    releaseIssue?.()

    await expect(first).resolves.toMatchObject({ reused: false, number: 42 })
    await expect(second).rejects.toMatchObject({ kind: 'pending', retryAfterSeconds: 2 })
    expect(turnstile.verify).toHaveBeenCalledTimes(1)
    expect(github.createExamRequest).toHaveBeenCalledTimes(1)
  })

  it('returns a retryable pending outcome when a winner does not finish in time', async () => {
    const repository = new FakeRepository()
    repository.current = { kind: 'pending', reservationId: 'other', marker: 'server-marker' }
    const { service, turnstile } = setup({ repository, wait: async () => undefined })
    await expect(service.submit(input())).rejects.toMatchObject({ kind: 'pending', retryAfterSeconds: 2 })
    expect(turnstile.verify).not.toHaveBeenCalled()
  })

  it('reconciles an ambiguous GitHub POST by stable marker without a second create or Turnstile redemption', async () => {
    const issue = { number: 42, url: 'https://github.com/issue/42' }
    const github: GitHubIssues = {
      getIssueState: vi.fn(),
      findOpenExamRequest: vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce(issue),
      createExamRequest: vi.fn().mockRejectedValue(new GitHubUpstreamError(true, true)),
    }
    const { service, repository, turnstile } = setup({ github })

    await expect(service.submit(input())).rejects.toMatchObject({ kind: 'githubUnavailable', retryable: true })
    expect(repository.current).toMatchObject({
      kind: 'reconciling',
      rateClaim: { claimId: `AB-730:${input().idempotencyKey}` },
    })
    await expect(service.submit(input())).resolves.toEqual({ ...issue, reused: true })

    expect(github.createExamRequest).toHaveBeenCalledTimes(1)
    expect(github.findOpenExamRequest).toHaveBeenCalledTimes(2)
    expect(turnstile.verify).toHaveBeenCalledTimes(1)
    expect(repository.finalizedClaims).toEqual([`AB-730:${input().idempotencyKey}`])
  })

  it('never posts again when issue discoverability is delayed beyond the pending TTL', async () => {
    const github: GitHubIssues = {
      getIssueState: vi.fn(),
      findOpenExamRequest: vi.fn().mockResolvedValue(null),
      createExamRequest: vi.fn().mockRejectedValue(new GitHubUpstreamError(true, true)),
    }
    const { service, repository, turnstile } = setup({ github })

    await expect(service.submit(input())).rejects.toMatchObject({ kind: 'githubUnavailable', retryable: true })
    await expect(service.submit(input({
      idempotencyKey: 'f70f449c-832b-4329-b5ee-1db5a5959677',
      nowMs: input().nowMs + 3_600_000,
    }))).rejects.toMatchObject({ kind: 'pending', retryAfterSeconds: 2 })

    expect(repository.current).toMatchObject({ kind: 'reconciling', reservationId: input().idempotencyKey })
    expect(github.createExamRequest).toHaveBeenCalledTimes(1)
    expect(turnstile.verify).toHaveBeenCalledTimes(1)
  })

  it('does not create when the authoritative issue listing is inconclusive', async () => {
    const github: GitHubIssues = {
      getIssueState: vi.fn(),
      findOpenExamRequest: vi.fn().mockRejectedValue(new GitHubUpstreamError(true)),
      createExamRequest: vi.fn(),
    }
    const { service, repository } = setup({ github })

    await expect(service.submit(input())).rejects.toMatchObject({ kind: 'githubUnavailable', retryable: true })
    expect(github.createExamRequest).not.toHaveBeenCalled()
    expect(repository.releases).toEqual([input().idempotencyKey])
  })

  it('releases a claimed slot when GitHub definitively rejects creation', async () => {
    const github: GitHubIssues = {
      getIssueState: vi.fn(),
      findOpenExamRequest: vi.fn().mockResolvedValue(null),
      createExamRequest: vi.fn().mockRejectedValue(new GitHubUpstreamError(false)),
    }
    const { service, repository } = setup({ github })
    await expect(service.submit(input())).rejects.toMatchObject({ kind: 'githubFailed', retryable: false })
    expect(repository.finalizedClaims).toEqual([])
    expect(repository.releasedClaims).toEqual([`AB-730:${input().idempotencyKey}`])
  })

  it('reconciles after Cosmos completion fails without duplicating the accepted issue or quota', async () => {
    const repository = new FakeRepository()
    repository.completeFailures = 1
    const issue = { number: 42, url: 'https://github.com/issue/42' }
    const github: GitHubIssues = {
      getIssueState: vi.fn(),
      findOpenExamRequest: vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce(issue),
      createExamRequest: vi.fn().mockResolvedValue(issue),
    }
    const { service, turnstile } = setup({ repository, github })

    await expect(service.submit(input())).rejects.toMatchObject({ kind: 'repositoryUnavailable', retryable: true })
    expect(repository.current).toMatchObject({ kind: 'reconciling' })
    await expect(service.submit(input())).resolves.toEqual({ ...issue, reused: true })

    expect(github.createExamRequest).toHaveBeenCalledTimes(1)
    expect(turnstile.verify).toHaveBeenCalledTimes(1)
    expect(repository.finalizedClaims).toEqual([
      `AB-730:${input().idempotencyKey}`,
      `AB-730:${input().idempotencyKey}`,
    ])
    expect(repository.completions).toEqual([issue])
  })

  it('maps transient repository failures to retryable unavailable', async () => {
    const repository = new FakeRepository()
    repository.reserve = vi.fn().mockRejectedValue(new ExamRequestRepositoryUnavailableError())
    const { service } = setup({ repository })
    await expect(service.submit(input())).rejects.toMatchObject({ kind: 'repositoryUnavailable', retryable: true })
  })
})