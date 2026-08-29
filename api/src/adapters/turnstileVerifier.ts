import type { TurnstileVerifier } from '../application/examRequestPorts'
import { TurnstileRejectedError, TurnstileUnavailableError } from '../domain/examRequests'

const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify'

export interface TurnstileVerifierOptions {
  secret: string
  expectedHostnames: readonly string[]
  expectedAction: string
  timeoutMs?: number
  fetch?: typeof fetch
}

interface SiteverifyResponse {
  success?: unknown
  hostname?: unknown
  action?: unknown
  'error-codes'?: unknown
}

const TOKEN_ERROR_CODES = new Set([
  'missing-input-response',
  'invalid-input-response',
  'timeout-or-duplicate',
])

export class CloudflareTurnstileVerifier implements TurnstileVerifier {
  private readonly fetch: typeof fetch
  private readonly timeoutMs: number
  private readonly expectedHostnames: ReadonlySet<string>

  constructor(private readonly options: TurnstileVerifierOptions) {
    if (!options.secret.trim()) throw new Error('A Turnstile secret is required.')
    if (options.expectedHostnames.length === 0) throw new Error('At least one Turnstile hostname is required.')
    if (!options.expectedAction.trim()) throw new Error('A Turnstile action is required.')
    this.fetch = options.fetch ?? globalThis.fetch
    this.timeoutMs = options.timeoutMs ?? 5_000
    this.expectedHostnames = new Set(options.expectedHostnames.map((value) => value.trim().toLowerCase()))
  }

  async verify(token: string, idempotencyKey: string, remoteIp?: string): Promise<void> {
    const body = new URLSearchParams({
      secret: this.options.secret,
      response: token,
      idempotency_key: idempotencyKey,
    })
    if (remoteIp) body.set('remoteip', remoteIp)

    let response: Response
    try {
      response = await this.fetch(SITEVERIFY_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body,
        signal: AbortSignal.timeout(this.timeoutMs),
      })
    } catch {
      throw new TurnstileUnavailableError()
    }
    if (!response.ok) throw new TurnstileUnavailableError()

    let result: SiteverifyResponse
    try {
      result = await response.json() as SiteverifyResponse
    } catch {
      throw new TurnstileUnavailableError()
    }
    if (typeof result !== 'object' || result === null || typeof result.success !== 'boolean') {
      throw new TurnstileUnavailableError()
    }
    if (result.success === false) {
      const errorCodes = result['error-codes']
      if (!Array.isArray(errorCodes) || errorCodes.length === 0 || !errorCodes.every((code) => typeof code === 'string')) {
        throw new TurnstileUnavailableError()
      }
      if (!errorCodes.every((code) => TOKEN_ERROR_CODES.has(code))) {
        throw new TurnstileUnavailableError()
      }
      throw new TurnstileRejectedError()
    }
    if (typeof result.hostname !== 'string' || typeof result.action !== 'string') {
      throw new TurnstileUnavailableError()
    }
    const hostname = result.hostname.toLowerCase()
    if (
      !this.expectedHostnames.has(hostname)
      || result.action !== this.options.expectedAction
    ) {
      throw new TurnstileRejectedError()
    }
  }
}