import { generateKeyPairSync } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { trustedClientAddress } from '../src/adapters/clientAddress'
import { GitHubAppIssues } from '../src/adapters/githubIssues'
import { CloudflareTurnstileVerifier } from '../src/adapters/turnstileVerifier'
import { TurnstileRejectedError, TurnstileUnavailableError } from '../src/domain/examRequests'

describe('trustedClientAddress', () => {
  it('uses only the platform-appended rightmost valid XFF hop', () => {
    expect(trustedClientAddress('203.0.113.9, 198.51.100.4')).toBe('198.51.100.4')
    expect(trustedClientAddress('spoofed, 203.0.113.8:443')).toBe('203.0.113.8')
    expect(trustedClientAddress('spoofed, [2001:db8::1]:443')).toBe('2001:db8::1')
  })

  it('fails best effort instead of trusting a valid prepended spoof when the rightmost hop is invalid', () => {
    expect(trustedClientAddress('203.0.113.9, forged')).toBeUndefined()
    expect(trustedClientAddress(null)).toBeUndefined()
  })
})

describe('CloudflareTurnstileVerifier', () => {
  it('forwards Cloudflare idempotency and verifies exact hostname and action', async () => {
    const mockedFetch = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      success: true,
      hostname: 'flashcards.example',
      action: 'exam-request',
    }), { status: 200 }))
    const verifier = new CloudflareTurnstileVerifier({
      secret: 'server-secret',
      expectedHostnames: ['flashcards.example'],
      expectedAction: 'exam-request',
      fetch: mockedFetch,
    })

    await verifier.verify('single-use-token', '48e228f6-c629-46d4-bb37-00510cfbc274', '203.0.113.7')

    const init = mockedFetch.mock.calls[0]?.[1]
    const body = init?.body as URLSearchParams
    expect(body.get('idempotency_key')).toBe('48e228f6-c629-46d4-bb37-00510cfbc274')
    expect(body.get('response')).toBe('single-use-token')
    expect(body.get('remoteip')).toBe('203.0.113.7')
    expect(init?.signal).toBeInstanceOf(AbortSignal)
  })

  it.each([
    { success: false, hostname: 'flashcards.example', action: 'exam-request', 'error-codes': ['invalid-input-response'] },
    { success: true, hostname: 'evil.example', action: 'exam-request' },
    { success: true, hostname: 'flashcards.example', action: 'other-action' },
  ])('rejects failed, wrong-host, and wrong-action responses', async (result) => {
    const verifier = new CloudflareTurnstileVerifier({
      secret: 'server-secret', expectedHostnames: ['flashcards.example'], expectedAction: 'exam-request',
      fetch: vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(result), { status: 200 })),
    })
    await expect(verifier.verify('token', '48e228f6-c629-46d4-bb37-00510cfbc274')).rejects.toBeInstanceOf(TurnstileRejectedError)
  })

  it('classifies network, HTTP, and malformed-response failures as unavailable', async () => {
    for (const mockedFetch of [
      vi.fn<typeof fetch>().mockRejectedValue(new Error('network body that must stay private')),
      vi.fn<typeof fetch>().mockResolvedValue(new Response('', { status: 503 })),
      vi.fn<typeof fetch>().mockResolvedValue(new Response('not-json', { status: 200 })),
      vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ success: true }), { status: 200 })),
      vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ success: false, 'error-codes': ['internal-error'] }), { status: 200 })),
      vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ success: false, 'error-codes': 'invalid-input-response' }), { status: 200 })),
      vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ success: false, 'error-codes': ['unknown-code'] }), { status: 200 })),
    ]) {
      const verifier = new CloudflareTurnstileVerifier({
        secret: 'server-secret', expectedHostnames: ['flashcards.example'], expectedAction: 'exam-request', fetch: mockedFetch,
      })
      await expect(verifier.verify('token', '48e228f6-c629-46d4-bb37-00510cfbc274')).rejects.toBeInstanceOf(TurnstileUnavailableError)
    }
  })
})

function githubSetup(responses: Response[], maxIssueListPages?: number) {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
  const mockedFetch = vi.fn<typeof fetch>()
  for (const response of responses) mockedFetch.mockResolvedValueOnce(response)
  const github = new GitHubAppIssues({
    appId: '123',
    installationId: '456',
    privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    owner: 'sifiadlene',
    repository: 'azure-cert-flashcards',
    assignee: 'sifiadlene',
    maxIssueListPages,
    fetch: mockedFetch,
    nowMs: () => Date.parse('2026-08-29T12:00:00Z'),
  })
  return { github, mockedFetch }
}

function tokenResponse(): Response {
  return new Response(JSON.stringify({ token: 'installation-token', expires_at: '2026-08-29T13:00:00Z' }), { status: 201 })
}

describe('GitHubAppIssues', () => {
  it('mints and caches an installation token and reads live issue state', async () => {
    const { github, mockedFetch } = githubSetup([
      tokenResponse(),
      new Response(JSON.stringify({ state: 'open' }), { status: 200 }),
      new Response(JSON.stringify({ state: 'closed' }), { status: 200 }),
    ])
    await expect(github.getIssueState(12)).resolves.toBe('open')
    await expect(github.getIssueState(13)).resolves.toBe('closed')
    expect(mockedFetch).toHaveBeenCalledTimes(3)
    expect(mockedFetch.mock.calls[0]?.[0]).toContain('/app/installations/456/access_tokens')
    expect(mockedFetch.mock.calls[1]?.[0]).toContain('/issues/12')
    expect(mockedFetch.mock.calls[2]?.[0]).toContain('/issues/13')
  })

  it('coalesces concurrent installation-token requests', async () => {
    const { github, mockedFetch } = githubSetup([
      tokenResponse(),
      new Response(JSON.stringify({ state: 'open' }), { status: 200 }),
      new Response(JSON.stringify({ state: 'open' }), { status: 200 }),
    ])
    await Promise.all([github.getIssueState(12), github.getIssueState(13)])
    expect(mockedFetch.mock.calls.filter(([url]) => String(url).includes('/access_tokens'))).toHaveLength(1)
  })

  it('creates only the stable server-derived payload', async () => {
    const { github, mockedFetch } = githubSetup([
      tokenResponse(),
      new Response(JSON.stringify({
        number: 42,
        html_url: 'https://github.com/sifiadlene/azure-cert-flashcards/issues/42',
      }), { status: 201 }),
    ])
    await expect(github.createExamRequest({
      code: 'AB-730', title: 'AI Business Professional', sourceUrl: 'https://learn.microsoft.com/source',
      marker: 'stable-marker',
    })).resolves.toEqual({ number: 42, url: 'https://github.com/sifiadlene/azure-cert-flashcards/issues/42' })

    const payload = JSON.parse(String(mockedFetch.mock.calls[1]?.[1]?.body)) as Record<string, unknown>
    expect(payload).toEqual({
      title: 'Request exam: AB-730',
      body: 'Please add flashcards for **AB-730 — AI Business Professional**.\n\nMicrosoft Learn source: https://learn.microsoft.com/source\n\n<!-- exam-request-marker:stable-marker -->',
      labels: ['exam-request'],
      assignees: ['sifiadlene'],
    })
  })

  it('lists open repository issues by marker with pagination and excludes pull requests', async () => {
    const marker = 'a'.repeat(64)
    const fullPage = Array.from({ length: 100 }, (_, number) => ({
      number: number + 1,
      html_url: `https://github.com/sifiadlene/azure-cert-flashcards/issues/${number + 1}`,
      body: number === 0 ? `request\n<!-- exam-request-marker:${marker} -->` : null,
      ...(number === 0 ? { pull_request: { url: 'https://api.github.com/pulls/1' } } : {}),
    }))
    const { github, mockedFetch } = githubSetup([
      tokenResponse(),
      new Response(JSON.stringify(fullPage), { status: 200 }),
      new Response(JSON.stringify([{
        number: 42,
        html_url: 'https://github.com/sifiadlene/azure-cert-flashcards/issues/42',
        body: `request\n<!-- exam-request-marker:${marker} -->`,
      }]), { status: 200 }),
    ])
    await expect(github.findOpenExamRequest(marker)).resolves.toEqual({
      number: 42, url: 'https://github.com/sifiadlene/azure-cert-flashcards/issues/42',
    })
    expect(String(mockedFetch.mock.calls[1]?.[0])).toContain('/repos/sifiadlene/azure-cert-flashcards/issues?state=open&per_page=100&page=1')
    expect(String(mockedFetch.mock.calls[2]?.[0])).toContain('&page=2')
  })

  it('fails safely when the issue-list pagination cap is inconclusive', async () => {
    const fullPage = Array.from({ length: 100 }, (_, number) => ({
      number: number + 1,
      html_url: `https://github.com/sifiadlene/azure-cert-flashcards/issues/${number + 1}`,
      body: null,
    }))
    const { github, mockedFetch } = githubSetup([
      tokenResponse(),
      new Response(JSON.stringify(fullPage), { status: 200 }),
      new Response(JSON.stringify(fullPage), { status: 200 }),
    ], 2)

    await expect(github.findOpenExamRequest('not-listed')).rejects.toMatchObject({ retryable: true })
    expect(mockedFetch).toHaveBeenCalledTimes(3)
  })

  it('marks a network failure during issue creation as an unknown outcome', async () => {
    const setup = githubSetup([tokenResponse()])
    setup.mockedFetch.mockRejectedValueOnce(new Error('network'))
    await expect(setup.github.createExamRequest({
      code: 'AB-730', title: 'AI Business Professional', sourceUrl: 'https://learn.microsoft.com/source', marker: 'stable-marker',
    })).rejects.toMatchObject({ retryable: true, outcomeUnknown: true })
  })

  it('classifies throttling and server failures as retryable without exposing response bodies', async () => {
    const throttled = githubSetup([tokenResponse(), new Response('private error', {
      status: 403, headers: { 'x-ratelimit-remaining': '0' },
    })]).github
    await expect(throttled.getIssueState(1)).rejects.toMatchObject({ retryable: true })

    const badRequest = githubSetup([tokenResponse(), new Response('private error', { status: 422 })]).github
    await expect(badRequest.getIssueState(1)).rejects.toMatchObject({ retryable: false })

    const network = githubSetup([tokenResponse()])
    network.mockedFetch.mockRejectedValueOnce(new Error('network'))
    await expect(network.github.getIssueState(1)).rejects.toMatchObject({ retryable: true })
  })
})