import { describe, expect, it, vi } from 'vitest'
import {
  createExamRequestDraft,
  errorTranslationKey,
  ExamRequestApiClient,
  ExamRequestApiError,
  type ExamRequestErrorKind,
} from './apiClient'

const issueResponse = {
  number: 42,
  url: 'https://github.com/sifiadlene/azure-cert-flashcards/issues/42',
  reused: false,
  traceId: 'trace-42',
}

function response(body: unknown, status = 200, headers?: HeadersInit): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  })
}

describe('ExamRequestApiClient', () => {
  it.each([
    [201, false],
    [200, true],
  ])('accepts strict new and reused issue responses', async (status, reused) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response({ ...issueResponse, reused }, status))
    const client = new ExamRequestApiClient('https://api.example.test/api/', fetcher)

    await expect(client.submit({ examCode: 'AB-730', idempotencyKey: 'request-id' }, 'token')).resolves.toEqual({
      number: 42,
      issueUrl: issueResponse.url,
      reused,
      traceId: 'trace-42',
    })
    expect(fetcher).toHaveBeenCalledWith('https://api.example.test/api/exam-requests', expect.objectContaining({
      method: 'POST',
      headers: { 'content-type': 'application/json' },
    }))
  })

  it('retains one idempotency key across a network retry', async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockRejectedValueOnce(new TypeError('offline'))
      .mockResolvedValueOnce(response(issueResponse, 201))
    const client = new ExamRequestApiClient('/api', fetcher)
    const draft = createExamRequestDraft('AB-730', () => 'same-request-id')

    await expect(client.submit(draft, 'same-token')).rejects.toMatchObject({ kind: 'network', retryable: true })
    await client.submit(draft, 'same-token')

    const bodies = fetcher.mock.calls.map(([, init]) => JSON.parse(String(init?.body)) as Record<string, string>)
    expect(bodies).toEqual([
      { examCode: 'AB-730', idempotencyKey: 'same-request-id', turnstileToken: 'same-token' },
      { examCode: 'AB-730', idempotencyKey: 'same-request-id', turnstileToken: 'same-token' },
    ])
  })

  it('maps sanitized API errors and Retry-After without exposing response messages', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response({
      error: { kind: 'rateLimited', retryable: true, message: 'upstream secret' },
    }, 429, { 'retry-after': '75' }))
    const client = new ExamRequestApiClient('/api', fetcher)

    const error = await client.submit({ examCode: 'AB-730', idempotencyKey: 'request-id' }, 'token')
      .catch((value: unknown) => value)

    expect(error).toBeInstanceOf(ExamRequestApiError)
    expect(error).toMatchObject({ kind: 'rateLimited', retryable: true, status: 429, retryAfterSeconds: 75 })
    expect((error as Error).message).not.toContain('upstream secret')
  })

  it.each([
    'http://github.com/sifiadlene/azure-cert-flashcards/issues/42',
    'https://github.com/other/repository/issues/42',
    'https://github.com/sifiadlene/azure-cert-flashcards/issues/42?redirect=evil',
    'javascript:alert(1)',
  ])('rejects an unsafe issue link: %s', async (url) => {
    const client = new ExamRequestApiClient('/api', vi.fn<typeof fetch>().mockResolvedValue(response({ ...issueResponse, url }, 201)))
    await expect(client.submit({ examCode: 'AB-730', idempotencyKey: 'request-id' }, 'token'))
      .rejects.toMatchObject({ kind: 'internal', retryable: true })
  })
})

describe('exam request error presentation', () => {
  it.each<[ExamRequestErrorKind, string]>([
    ['validation', 'examRequest.errors.validation'],
    ['supported', 'examRequest.errors.supported'],
    ['turnstileRejected', 'examRequest.errors.turnstileRejected'],
    ['rateLimited', 'examRequest.errors.rateLimited'],
    ['network', 'examRequest.errors.network'],
    ['githubFailed', 'examRequest.errors.nonRetryable'],
    ['pending', 'examRequest.errors.retryable'],
  ])('maps %s to a controlled localization key', (kind, key) => {
    expect(errorTranslationKey(kind)).toBe(key)
  })
})
