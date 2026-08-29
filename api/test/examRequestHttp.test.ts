import type { HttpRequest, InvocationContext } from '@azure/functions'
import { describe, expect, it, vi } from 'vitest'
import { createChallengeServiceFromEnvironment } from '../src/application/composition'
import { createExamRequestServiceFromEnvironment } from '../src/application/examRequestComposition'
import type { ExamRequestService } from '../src/application/examRequestService'
import { ExamRequestApplicationError } from '../src/domain/examRequests'
import { createExamRequestHandler } from '../src/http/examRequestHandler'

const validBody = {
  examCode: 'AB-730',
  idempotencyKey: '48e228f6-c629-46d4-bb37-00510cfbc274',
  turnstileToken: 'test-token',
}

function request(body: unknown, headers: Record<string, string> = {}): HttpRequest {
  const text = typeof body === 'string' ? body : JSON.stringify(body)
  return { headers: new Headers(headers), text: async () => text } as unknown as HttpRequest
}

function serviceReturning(value: unknown): { service: ExamRequestService; submit: ReturnType<typeof vi.fn> } {
  const submit = vi.fn().mockResolvedValue(value)
  return { service: { submit } as unknown as ExamRequestService, submit }
}

function serviceRejecting(error: unknown): ExamRequestService {
  return { submit: vi.fn().mockRejectedValue(error) } as unknown as ExamRequestService
}

function context() {
  return { error: vi.fn() } as unknown as InvocationContext
}

describe('exam-request HTTP handler', () => {
  it('strictly accepts only normalized code, UUID idempotency key, and Turnstile token', async () => {
    const factory = vi.fn<() => Promise<ExamRequestService>>()
    const handler = createExamRequestHandler(factory)
    const response = await handler(request({ ...validBody, title: 'Injected issue title' }), context())
    expect(response.status).toBe(400)
    expect(response.jsonBody).toMatchObject({ error: { kind: 'validation', retryable: false } })
    expect(factory).not.toHaveBeenCalled()
  })

  it('enforces the shared 16 KB body limit before composition', async () => {
    const factory = vi.fn<() => Promise<ExamRequestService>>()
    const response = await createExamRequestHandler(factory)(request(validBody, { 'content-length': '16385' }), context())
    expect(response.status).toBe(400)
    expect(factory).not.toHaveBeenCalled()
  })

  it.each([
    [{ number: 42, url: 'https://github.com/issue/42', reused: false }, 201],
    [{ number: 42, url: 'https://github.com/issue/42', reused: true }, 200],
  ])('returns synchronous creation/reuse outcomes with trace ID and no-store', async (result, status) => {
    const { service, submit } = serviceReturning(result)
    const response = await createExamRequestHandler(async () => service)(request(validBody, {
      'x-forwarded-for': 'spoofed, 203.0.113.8',
    }), context())
    expect(response.status).toBe(status)
    expect(response.headers).toMatchObject({ 'cache-control': 'no-store' })
    expect(response.jsonBody).toMatchObject({ ...result, traceId: expect.any(String) })
    expect(submit).toHaveBeenCalledWith(expect.objectContaining({
      examCode: 'AB-730', remoteIp: '203.0.113.8', traceId: expect.any(String), nowMs: expect.any(Number),
    }))
  })

  it.each([
    ['validation', false, 400],
    ['turnstileRejected', false, 403],
    ['supported', false, 409],
    ['rateLimited', true, 429],
    ['githubFailed', false, 502],
    ['turnstileUnavailable', true, 503],
    ['githubUnavailable', true, 503],
    ['repositoryUnavailable', true, 503],
    ['pending', true, 503],
  ] as const)('maps %s to its sanitized API status', async (kind, retryable, status) => {
    const error = new ExamRequestApplicationError(kind, retryable, retryable ? 7 : undefined)
    const response = await createExamRequestHandler(async () => serviceRejecting(error))(request(validBody), context())
    expect(response.status).toBe(status)
    expect(response.jsonBody).toMatchObject({ error: { kind, retryable, traceId: expect.any(String) } })
    if (retryable) expect(response.headers).toMatchObject({ 'retry-after': '7' })
  })

  it('does not leak unexpected error content to logs or responses', async () => {
    const invocation = context()
    const response = await createExamRequestHandler(async () => serviceRejecting(new Error('token/private upstream body')))(request(validBody), invocation)
    expect(response.status).toBe(500)
    expect(JSON.stringify(response.jsonBody)).not.toContain('token/private')
    expect(invocation.error).toHaveBeenCalledWith('Exam request failed.', { traceId: expect.any(String) })
    expect(JSON.stringify((invocation.error as ReturnType<typeof vi.fn>).mock.calls)).not.toContain('token/private')
  })
})

describe('exam-request composition isolation', () => {
  it('fails missing exam-request settings only when that slice is composed', async () => {
    expect(() => createChallengeServiceFromEnvironment({
      CHALLENGE_LOCAL_IN_MEMORY: 'true',
      CHALLENGE_TOKEN_PEPPER: Buffer.alloc(32, 1).toString('base64'),
    })).not.toThrow()

    await expect(createExamRequestServiceFromEnvironment({})).rejects.toThrow('EXAM_REQUEST_GITHUB_PRIVATE_KEY_BASE64')
  })
})