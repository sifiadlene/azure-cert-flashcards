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
  | 'network'

export interface ExamRequestDraft {
  examCode: string
  idempotencyKey: string
}

export interface ExamRequestResult {
  number: number
  issueUrl: string
  reused: boolean
  traceId: string
}

export class ExamRequestApiError extends Error {
  readonly kind: ExamRequestErrorKind
  readonly retryable: boolean
  readonly status: number
  readonly retryAfterSeconds?: number

  constructor(
    kind: ExamRequestErrorKind,
    retryable: boolean,
    status: number,
    retryAfterSeconds?: number,
  ) {
    super(kind)
    this.name = 'ExamRequestApiError'
    this.kind = kind
    this.retryable = retryable
    this.status = status
    this.retryAfterSeconds = retryAfterSeconds
  }
}

const ERROR_KINDS = new Set<ExamRequestErrorKind>([
  'validation',
  'supported',
  'turnstileRejected',
  'rateLimited',
  'turnstileUnavailable',
  'githubUnavailable',
  'githubFailed',
  'repositoryUnavailable',
  'pending',
  'internal',
])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function normalizeBaseUrl(value: string): string {
  return value.replace(/\/$/, '')
}

function safeIssueUrl(value: unknown, issueNumber: number): string | null {
  if (typeof value !== 'string') return null
  try {
    const url = new URL(value)
    const expectedPath = `/sifiadlene/azure-cert-flashcards/issues/${issueNumber}`
    if (url.protocol !== 'https:'
      || url.hostname !== 'github.com'
      || url.pathname !== expectedPath
      || url.username
      || url.password
      || url.search
      || url.hash) {
      return null
    }
    return url.href
  } catch {
    return null
  }
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json() as unknown
  } catch {
    return null
  }
}

function retryAfterSeconds(response: Response): number | undefined {
  const value = Number(response.headers.get('retry-after'))
  return Number.isInteger(value) && value > 0 ? value : undefined
}

export function createExamRequestDraft(
  examCode: string,
  createUuid: () => string = () => crypto.randomUUID(),
): ExamRequestDraft {
  return { examCode, idempotencyKey: createUuid() }
}

export function errorTranslationKey(kind: ExamRequestErrorKind): string {
  switch (kind) {
    case 'validation': return 'examRequest.errors.validation'
    case 'supported': return 'examRequest.errors.supported'
    case 'turnstileRejected': return 'examRequest.errors.turnstileRejected'
    case 'rateLimited': return 'examRequest.errors.rateLimited'
    case 'network': return 'examRequest.errors.network'
    case 'githubFailed': return 'examRequest.errors.nonRetryable'
    case 'turnstileUnavailable':
    case 'githubUnavailable':
    case 'repositoryUnavailable':
    case 'pending':
    case 'internal':
      return 'examRequest.errors.retryable'
  }
}

export class ExamRequestApiClient {
  private readonly baseUrl: string
  private readonly fetcher: typeof fetch

  constructor(
    baseUrl = import.meta.env.VITE_PUBLIC_API_BASE ?? '/api',
    fetcher: typeof fetch = globalThis.fetch.bind(globalThis),
  ) {
    this.baseUrl = normalizeBaseUrl(baseUrl)
    this.fetcher = fetcher
  }

  async submit(draft: ExamRequestDraft, turnstileToken: string): Promise<ExamRequestResult> {
    let response: Response
    try {
      response = await this.fetcher(`${this.baseUrl}/exam-requests`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          examCode: draft.examCode,
          idempotencyKey: draft.idempotencyKey,
          turnstileToken,
        }),
      })
    } catch {
      throw new ExamRequestApiError('network', true, 0)
    }

    const body = await readJson(response)
    if (!response.ok) {
      const error = isRecord(body) && isRecord(body.error) ? body.error : null
      const kind = error && typeof error.kind === 'string' && ERROR_KINDS.has(error.kind as ExamRequestErrorKind)
        ? error.kind as ExamRequestErrorKind
        : 'internal'
      const retryable = error ? error.retryable === true : response.status >= 500
      throw new ExamRequestApiError(kind, retryable, response.status, retryAfterSeconds(response))
    }

    if ((response.status !== 200 && response.status !== 201)
      || !isRecord(body)
      || typeof body.number !== 'number'
      || !Number.isSafeInteger(body.number)
      || body.number < 1
      || typeof body.reused !== 'boolean'
      || body.reused !== (response.status === 200)
      || typeof body.traceId !== 'string') {
      throw new ExamRequestApiError('internal', true, response.status)
    }
    const issueUrl = safeIssueUrl(body.url, body.number)
    if (!issueUrl) throw new ExamRequestApiError('internal', true, response.status)

    return {
      number: body.number,
      issueUrl,
      reused: body.reused,
      traceId: body.traceId,
    }
  }
}
