import { createSign } from 'node:crypto'
import type { GitHubIssues } from '../application/examRequestPorts'
import { GitHubUpstreamError, type ExamRequestIssue } from '../domain/examRequests'

const GITHUB_API = 'https://api.github.com'
const TOKEN_REFRESH_SKEW_MS = 60_000
const ISSUES_PER_PAGE = 100
const DEFAULT_MAX_ISSUE_LIST_PAGES = 20

export interface GitHubAppIssuesOptions {
  appId: string
  installationId: string
  privateKey: string
  owner: string
  repository: string
  assignee: string
  label?: string
  timeoutMs?: number
  maxIssueListPages?: number
  fetch?: typeof fetch
  nowMs?: () => number
}

interface CachedToken {
  value: string
  expiresAtMs: number
}

function base64Url(value: string): string {
  return Buffer.from(value).toString('base64url')
}

export class GitHubAppIssues implements GitHubIssues {
  private readonly fetch: typeof fetch
  private readonly nowMs: () => number
  private readonly timeoutMs: number
  private readonly maxIssueListPages: number
  private cachedToken?: CachedToken
  private tokenPromise?: Promise<CachedToken>

  constructor(private readonly options: GitHubAppIssuesOptions) {
    for (const [name, value] of Object.entries({
      appId: options.appId,
      installationId: options.installationId,
      privateKey: options.privateKey,
      owner: options.owner,
      repository: options.repository,
      assignee: options.assignee,
    })) {
      if (!value.trim()) throw new Error(`GitHub ${name} is required.`)
    }
    this.fetch = options.fetch ?? globalThis.fetch
    this.nowMs = options.nowMs ?? Date.now
    this.timeoutMs = options.timeoutMs ?? 5_000
    this.maxIssueListPages = options.maxIssueListPages ?? DEFAULT_MAX_ISSUE_LIST_PAGES
    if (!Number.isInteger(this.maxIssueListPages) || this.maxIssueListPages < 1 || this.maxIssueListPages > 100) {
      throw new Error('GitHub maxIssueListPages must be an integer between 1 and 100.')
    }
  }

  async getIssueState(issueNumber: number): Promise<'open' | 'closed'> {
    const response = await this.authenticatedFetch(`/repos/${this.options.owner}/${this.options.repository}/issues/${issueNumber}`, {
      method: 'GET',
    })
    const body = await this.readJson(response)
    if (body.state !== 'open' && body.state !== 'closed') throw new GitHubUpstreamError(false)
    return body.state
  }

  async findOpenExamRequest(marker: string): Promise<ExamRequestIssue | null> {
    const expectedMarker = `<!-- exam-request-marker:${marker} -->`
    for (let page = 1; page <= this.maxIssueListPages; page += 1) {
      const response = await this.authenticatedFetch(
        `/repos/${this.options.owner}/${this.options.repository}/issues?state=open&per_page=${ISSUES_PER_PAGE}&page=${page}`,
        { method: 'GET' },
      )
      const candidates = await this.readJsonArray(response)
      for (const candidate of candidates) {
        if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) continue
        const item = candidate as Record<string, unknown>
        if (Object.hasOwn(item, 'pull_request')) continue
        if (typeof item.body !== 'string' || !item.body.includes(expectedMarker)) continue
        const issue = this.validIssue(item)
        if (issue) return issue
      }
      if (candidates.length < ISSUES_PER_PAGE) return null
    }
    // Reaching the safety cap is inconclusive. Never report a false negative that could permit another POST.
    throw new GitHubUpstreamError(true)
  }

  async createExamRequest(input: { code: string; title: string; sourceUrl: string; marker: string }): Promise<ExamRequestIssue> {
    const response = await this.authenticatedFetch(`/repos/${this.options.owner}/${this.options.repository}/issues`, {
      method: 'POST',
      body: JSON.stringify({
        title: `Request exam: ${input.code}`,
        body: `Please add flashcards for **${input.code} — ${input.title}**.\n\nMicrosoft Learn source: ${input.sourceUrl}\n\n<!-- exam-request-marker:${input.marker} -->`,
        labels: [this.options.label ?? 'exam-request'],
        assignees: [this.options.assignee],
      }),
    }, true)
    let body: Record<string, unknown>
    try {
      body = await this.readJson(response)
    } catch {
      // A successful HTTP response with an unreadable body may still have created the issue.
      throw new GitHubUpstreamError(true, true)
    }
    const issue = this.validIssue(body)
    if (!issue) throw new GitHubUpstreamError(true, true)
    return issue
  }

  private validIssue(body: Record<string, unknown>): ExamRequestIssue | null {
    if (!Number.isInteger(body.number) || typeof body.html_url !== 'string') return null
    const expectedPrefix = `https://github.com/${this.options.owner}/${this.options.repository}/issues/`
    if (body.html_url !== `${expectedPrefix}${String(body.number)}`) return null
    return { number: body.number as number, url: body.html_url }
  }

  private async authenticatedFetch(path: string, init: RequestInit, mutation = false): Promise<Response> {
    let token = await this.installationToken()
    let response = await this.request(path, init, token, mutation)
    if (response.status === 401) {
      this.cachedToken = undefined
      token = await this.installationToken()
      response = await this.request(path, init, token, mutation)
    }
    if (!response.ok) throw this.responseError(response, mutation)
    return response
  }

  private async request(path: string, init: RequestInit, token: string, mutation: boolean): Promise<Response> {
    try {
      return await this.fetch(`${GITHUB_API}${path}`, {
        ...init,
        headers: {
          accept: 'application/vnd.github+json',
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
          'user-agent': 'certification-flashcards-exam-requests',
          'x-github-api-version': '2022-11-28',
        },
        signal: AbortSignal.timeout(this.timeoutMs),
      })
    } catch {
      throw new GitHubUpstreamError(true, mutation)
    }
  }

  private async installationToken(): Promise<string> {
    if (this.cachedToken && this.cachedToken.expiresAtMs - TOKEN_REFRESH_SKEW_MS > this.nowMs()) {
      return this.cachedToken.value
    }
    const pending = this.tokenPromise ??= this.mintInstallationToken()
    try {
      const token = await pending
      this.cachedToken = token
      return token.value
    } finally {
      if (this.tokenPromise === pending) this.tokenPromise = undefined
    }
  }

  private async mintInstallationToken(): Promise<CachedToken> {
    const jwt = this.appJwt()
    let response: Response
    try {
      response = await this.fetch(`${GITHUB_API}/app/installations/${this.options.installationId}/access_tokens`, {
        method: 'POST',
        headers: {
          accept: 'application/vnd.github+json',
          authorization: `Bearer ${jwt}`,
          'content-type': 'application/json',
          'user-agent': 'certification-flashcards-exam-requests',
          'x-github-api-version': '2022-11-28',
        },
        body: JSON.stringify({ repositories: [this.options.repository], permissions: { issues: 'write' } }),
        signal: AbortSignal.timeout(this.timeoutMs),
      })
    } catch {
      throw new GitHubUpstreamError(true)
    }
    if (!response.ok) throw this.responseError(response)
    const body = await this.readJson(response)
    const expiresAtMs = typeof body.expires_at === 'string' ? Date.parse(body.expires_at) : Number.NaN
    if (typeof body.token !== 'string' || !Number.isFinite(expiresAtMs)) throw new GitHubUpstreamError(false)
    return { value: body.token, expiresAtMs }
  }

  private appJwt(): string {
    const issuedAt = Math.floor(this.nowMs() / 1_000) - 60
    const header = base64Url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
    const payload = base64Url(JSON.stringify({ iat: issuedAt, exp: issuedAt + 540, iss: this.options.appId }))
    const unsigned = `${header}.${payload}`
    const signature = createSign('RSA-SHA256').update(unsigned).end().sign(this.options.privateKey, 'base64url')
    return `${unsigned}.${signature}`
  }

  private async readJson(response: Response): Promise<Record<string, unknown>> {
    try {
      const value = await response.json() as unknown
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid JSON object.')
      return value as Record<string, unknown>
    } catch {
      throw new GitHubUpstreamError(false)
    }
  }

  private async readJsonArray(response: Response): Promise<unknown[]> {
    try {
      const value = await response.json() as unknown
      if (!Array.isArray(value)) throw new Error('Invalid JSON array.')
      return value
    } catch {
      throw new GitHubUpstreamError(true)
    }
  }

  private responseError(response: Response, mutation = false): GitHubUpstreamError {
    const throttled = response.status === 429
      || (response.status === 403 && (response.headers.has('retry-after') || response.headers.get('x-ratelimit-remaining') === '0'))
    const retryable = throttled || response.status >= 500
    return new GitHubUpstreamError(retryable, mutation && retryable)
  }
}