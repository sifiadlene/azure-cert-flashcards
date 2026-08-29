import type { HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { trustedClientAddress } from '../adapters/clientAddress'
import type { ExamRequestService } from '../application/examRequestService'
import { ExamRequestApplicationError } from '../domain/examRequests'

const MAX_BODY_BYTES = 16_384

export const examRequestSchema = z.object({
  examCode: z.string().regex(/^[A-Z]{2}-\d{3}$/),
  idempotencyKey: z.uuid(),
  turnstileToken: z.string().min(1).max(2_048),
}).strict()

function errorStatus(error: ExamRequestApplicationError): number {
  switch (error.kind) {
    case 'validation': return 400
    case 'turnstileRejected': return 403
    case 'supported': return 409
    case 'rateLimited': return 429
    case 'githubFailed': return 502
    case 'turnstileUnavailable':
    case 'githubUnavailable':
    case 'repositoryUnavailable':
    case 'pending': return 503
    default: return 500
  }
}

function headers(retryAfterSeconds?: number): Record<string, string> {
  return {
    'cache-control': 'no-store',
    'content-type': 'application/json; charset=utf-8',
    ...(retryAfterSeconds ? { 'retry-after': String(retryAfterSeconds) } : {}),
  }
}

function validationError(issues: ReadonlyArray<{ field: string; code: string; message: string }>): ExamRequestApplicationError {
  return new ExamRequestApplicationError('validation', false, undefined, issues)
}

async function parseBody(request: HttpRequest): Promise<z.infer<typeof examRequestSchema>> {
  const declaredLength = Number(request.headers.get('content-length') ?? '0')
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    throw validationError([{ field: 'body', code: 'outOfRange', message: 'Request body is too large.' }])
  }
  const text = await request.text()
  if (Buffer.byteLength(text, 'utf8') > MAX_BODY_BYTES) {
    throw validationError([{ field: 'body', code: 'outOfRange', message: 'Request body is too large.' }])
  }
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    throw validationError([{ field: 'body', code: 'invalidFormat', message: 'Request body must be valid JSON.' }])
  }
  const parsed = examRequestSchema.safeParse(value)
  if (!parsed.success) {
    throw validationError(parsed.error.issues.map((issue) => ({
      field: issue.path.join('.') || 'body',
      code: 'invalidValue',
      message: issue.message,
    })))
  }
  return parsed.data
}

export function createExamRequestHandler(serviceFactory: () => Promise<ExamRequestService>) {
  return async (request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> => {
    const traceId = randomUUID()
    try {
      const body = await parseBody(request)
      const service = await serviceFactory()
      const result = await service.submit({
        ...body,
        remoteIp: trustedClientAddress(request.headers.get('x-forwarded-for')),
        traceId,
        nowMs: Date.now(),
      })
      return {
        status: result.reused ? 200 : 201,
        headers: headers(),
        jsonBody: { ...result, traceId },
      }
    } catch (error) {
      if (error instanceof ExamRequestApplicationError) {
        return {
          status: errorStatus(error),
          headers: headers(error.retryAfterSeconds),
          jsonBody: {
            error: {
              kind: error.kind,
              retryable: error.retryable,
              traceId,
              ...(error.issues ? { issues: error.issues } : {}),
            },
          },
        }
      }
      context.error('Exam request failed.', { traceId })
      return {
        status: 500,
        headers: headers(),
        jsonBody: { error: { kind: 'internal', retryable: true, traceId } },
      }
    }
  }
}