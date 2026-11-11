import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  SOURCE_PAGE_URL,
  buildCatalogCandidate,
  createReviewReport,
  serializeJson,
} from './exam-catalog.mjs'
import {
  authorizeProposal,
  findExistingProposal,
  preflight,
  renderReviewSummary,
  verifyApprovalHistory,
  verifyReviewReport,
} from './exam-catalog-review.mjs'

const checkedAt = '2026-11-11T09:17:00.000Z'
const originalAt = '2026-08-29T00:00:00.000Z'
const baseSha = 'a'.repeat(40)
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const context = {
  repository: 'sifiadlene/azure-cert-flashcards',
  defaultBranch: 'main',
  ref: 'refs/heads/main',
  sha: baseSha,
  baseSha,
  runId: '12345',
  attempt: '1',
  serverUrl: 'https://github.com',
}
const repoPath = '/repos/sifiadlene/azure-cert-flashcards'
const environmentPath = `${repoPath}/environments/exam-catalog-review`
const policyPath = `${environmentPath}/deployment-branch-policies?per_page=100&page=1`
const approvalPath = `${repoPath}/actions/runs/12345/approvals`
const environment = {
  id: 123,
  name: 'exam-catalog-review',
  deployment_branch_policy: { protected_branches: false, custom_branch_policies: true },
  protection_rules: [{
    type: 'required_reviewers',
    prevent_self_review: false,
    reviewers: [{ type: 'User', reviewer: { id: 456, login: 'sifiadlene' } }],
  }],
}
const policies = { total_count: 1, branch_policies: [{ type: 'branch', name: 'main' }] }
const approvals = [{
  state: 'approved',
  user: { id: 456, login: 'sifiadlene' },
  environments: [{ id: 123, name: 'exam-catalog-review' }],
}]

function reader(overrides = {}) {
  const responses = {
    [repoPath]: { default_branch: 'main' },
    [`${repoPath}/branches/main`]: { commit: { sha: baseSha } },
    [environmentPath]: environment,
    [policyPath]: policies,
    [approvalPath]: approvals,
    [`${repoPath}/pulls?state=open&per_page=100&page=1`]: [],
    ...overrides,
  }
  return async (endpoint) => {
    if (!(endpoint in responses)) throw new Error(`Unexpected GitHub read: ${endpoint}`)
    if (responses[endpoint] instanceof Error) throw responses[endpoint]
    return structuredClone(responses[endpoint])
  }
}

function exam(code, title, retrievedAt = originalAt) {
  return {
    code,
    title,
    sourceUrl: `https://learn.microsoft.com/en-us/credentials/certifications/exams/${code.toLowerCase()}/practice/assessment?assessment-type=practice`,
    sourcePageUrl: SOURCE_PAGE_URL,
    retrievedAt,
  }
}

function review(existing, parsed, at = checkedAt) {
  const candidate = buildCatalogCandidate(existing, parsed)
  const bytes = Buffer.from(serializeJson(candidate))
  const report = createReviewReport(existing, candidate, at, baseSha, bytes)
  return { candidate, bytes, report }
}

describe('exam catalog workflow safeguards', () => {
  it('records a successful no-op and binds the summary to detection outputs', async (t) => {
    const existing = { schemaVersion: 1, exams: [exam('AB-100', 'Existing')] }
    const parsed = { schemaVersion: 1, exams: [exam('AB-100', 'Existing', checkedAt)] }
    const { bytes, report } = review(existing, parsed)
    const verified = verifyReviewReport(existing, bytes, report, baseSha)
    const summary = renderReviewSummary(report)

    assert.equal(verified.hasChanges, false)
    assert.match(summary, /No semantic changes/)
    assert.ok(summary.includes(checkedAt))
    assert.ok(summary.includes(baseSha))
    assert.ok(summary.includes(report.candidateSha256))

    const directory = await mkdtemp(path.join(os.tmpdir(), 'exam-catalog-summary-'))
    t.after(() => rm(directory, { recursive: true, force: true }))
    const tracked = JSON.parse(await readFile(path.join(root, 'catalog', 'microsoft-learn-practice-assessments.json'), 'utf8'))
    const snapshot = review(tracked, tracked)
    const candidatePath = path.join(directory, 'candidate.json')
    const reportPath = path.join(directory, 'report.json')
    const summaryPath = path.join(directory, 'summary.md')
    const outputPath = path.join(directory, 'output.txt')
    await writeFile(candidatePath, snapshot.bytes)
    await writeFile(reportPath, serializeJson(snapshot.report))
    const result = spawnSync(process.execPath, [
      path.join(root, 'tools', 'exam-catalog-review.mjs'), 'summary',
      candidatePath, reportPath, baseSha, summaryPath, outputPath,
    ], { encoding: 'utf8' })
    assert.equal(result.status, 0, result.stderr)
    assert.match(await readFile(summaryPath, 'utf8'), new RegExp(snapshot.report.candidateSha256))
    assert.equal(await readFile(outputPath, 'utf8'),
      `candidate_sha256=${snapshot.report.candidateSha256}\nsemantic_sha256=${snapshot.report.semanticSha256}\n`)
  })

  it('renders escaped, per-code changes and rejects altered candidates or reports', () => {
    const existing = { schemaVersion: 1, exams: [exam('AB-100', 'Original'), exam('AB-200', 'Removed')] }
    const parsed = { schemaVersion: 1, exams: [
      exam('AB-100', 'Updated <review> [untrusted](https://example.com)', checkedAt),
      exam('AB-300', 'Added & available', checkedAt),
    ] }
    const { bytes, report } = review(existing, parsed)
    const verified = verifyReviewReport(existing, bytes, report, baseSha)
    const summary = renderReviewSummary(report)

    assert.equal(verified.hasChanges, true)
    assert.match(summary, /Added to the source/)
    assert.match(summary, /Absent from the source/)
    assert.match(summary, /does not establish retirement/)
    assert.match(summary, /Changed in the source/)
    assert.match(summary, /Updated &lt;review&gt;/)
    assert.ok(!summary.includes('[untrusted](https://example.com)'))
    assert.match(summary, /Added &amp; available/)
    assert.ok(summary.includes(report.semanticSha256))
    assert.throws(() => verifyReviewReport(existing, Buffer.from(`${bytes} `), report, baseSha), /does not match/)
    assert.throws(() => verifyReviewReport(existing, bytes, { ...report, removed: [] }, baseSha), /does not match/)
    assert.throws(() => verifyReviewReport(existing, bytes, report, 'b'.repeat(40)), /does not match/)
  })

  it('accepts the documented environment response and fails closed on unsafe protection, reviewers, branches and reruns', async () => {
    assert.deepEqual(await preflight(context, reader()), { environmentId: 123, reviewerId: 456 })
    const unsafeEnvironments = [
      { ...environment, deployment_branch_policy: null },
      { ...environment, protection_rules: [{ ...environment.protection_rules[0], prevent_self_review: true }] },
      { ...environment, protection_rules: [{ ...environment.protection_rules[0], reviewers: [
        ...environment.protection_rules[0].reviewers, { type: 'User', reviewer: { id: 789, login: 'other' } },
      ] }] },
      { ...environment, protection_rules: [{ ...environment.protection_rules[0], reviewers: [
        { type: 'User', reviewer: { id: 789, login: 'other' } },
      ] }] },
    ]
    for (const protection of unsafeEnvironments) {
      await assert.rejects(preflight(context, reader({ [environmentPath]: protection })), /environment/i)
    }
    for (const unsafePolicy of [
      { total_count: 1, branch_policies: [{ type: 'branch', name: '*' }] },
      { total_count: 1, branch_policies: [{ type: 'tag', name: 'main' }] },
      { total_count: 2, branch_policies: [{ type: 'branch', name: 'main' }] },
    ]) {
      await assert.rejects(preflight(context, reader({ [policyPath]: unsafePolicy })), /protection/)
    }
    await assert.rejects(preflight(context, reader({ [environmentPath]: new Error('HTTP 404') })), /404/)
    await assert.rejects(preflight({ ...context, ref: 'refs/heads/feature' }, reader()), /default branch/)
    await assert.rejects(preflight({ ...context, attempt: '2' }, reader()), /rerun/)
  })

  it('requires a single approval by the designated user for this environment', () => {
    const gate = { environmentId: 123, reviewerId: 456 }
    assert.doesNotThrow(() => verifyApprovalHistory(approvals, gate))
    for (const history of [
      [],
      [{ ...approvals[0], state: 'rejected' }],
      [{ ...approvals[0], user: { id: 789, login: 'other' } }],
      [{ ...approvals[0], environments: [{ id: 999, name: 'exam-catalog-review' }] }],
      [...approvals, { ...approvals[0], state: 'rejected' }],
    ]) {
      assert.throws(() => verifyApprovalHistory(history, gate), /approved this run/)
    }
    assert.throws(() => verifyApprovalHistory(null, gate), /unavailable/)
  })

  it('revalidates approval, exact bytes, current base and fresh upstream content', async () => {
    const base = { schemaVersion: 1, exams: [exam('AB-100', 'Original')] }
    const reviewed = review(base, { schemaVersion: 1, exams: [exam('AB-100', 'Updated', checkedAt)] })
    const freshAt = '2026-11-11T10:00:00.000Z'
    const fresh = review(base, { schemaVersion: 1, exams: [exam('AB-100', 'Updated', freshAt)] }, freshAt)
    const input = {
      base,
      candidateBytes: reviewed.bytes,
      report: reviewed.report,
      freshCandidateBytes: fresh.bytes,
      freshReport: fresh.report,
      environmentId: 123,
      reviewerId: 456,
      canary: false,
      expectedCandidateSha256: reviewed.report.candidateSha256,
      expectedSemanticSha256: reviewed.report.semanticSha256,
    }

    const authorized = await authorizeProposal(context, reader(), input)
    assert.equal(authorized.existingUrl, null)
    await assert.rejects(authorizeProposal(context, reader({ [`${repoPath}/branches/main`]: {
      commit: { sha: 'b'.repeat(40) },
    } }), input), /default branch changed/)
    await assert.rejects(authorizeProposal(context, reader({ [approvalPath]: [] }), input), /approved this run/)
    await assert.rejects(authorizeProposal(context, reader(), { ...input, candidateBytes: Buffer.from('{}') }), /catalog/)
    await assert.rejects(authorizeProposal(context, reader(), { ...input, environmentId: 999 }), /environment changed/)
    const changedAgain = review(base, { schemaVersion: 1, exams: [exam('AB-100', 'Different', freshAt)] }, freshAt)
    await assert.rejects(authorizeProposal(context, reader(), {
      ...input, freshCandidateBytes: changedAgain.bytes, freshReport: changedAgain.report,
    }), /upstream catalog changed/)
    await assert.rejects(authorizeProposal(context, reader(), {
      ...input, candidateBytes: changedAgain.bytes, report: changedAgain.report,
      freshCandidateBytes: changedAgain.bytes, freshReport: changedAgain.report,
    }), /does not match the detection run/)

    const unchanged = review(base, { schemaVersion: 1, exams: [exam('AB-100', 'Original', checkedAt)] })
    const noChange = { ...input, candidateBytes: unchanged.bytes, report: unchanged.report,
      freshCandidateBytes: unchanged.bytes, freshReport: unchanged.report,
      expectedCandidateSha256: unchanged.report.candidateSha256,
      expectedSemanticSha256: unchanged.report.semanticSha256 }
    await assert.rejects(authorizeProposal(context, reader(), noChange), /unchanged catalog/)
    assert.equal((await authorizeProposal(context, reader(), { ...noChange, canary: true })).existingUrl, null)
  })

  it('paginates duplicate proposals and recognizes both their marker and branch fingerprint', async () => {
    const semanticSha = 'c'.repeat(64)
    const firstPage = Array.from({ length: 100 }, () => ({ state: 'open', body: null, head: { ref: 'other' } }))
    const matching = {
      state: 'open',
      number: 73,
      html_url: 'https://github.com/sifiadlene/azure-cert-flashcards/pull/73',
      body: `<!-- exam-catalog-semantic-sha256:${semanticSha} -->`,
      head: { ref: 'other' },
    }
    const url = await findExistingProposal(context, reader({
      [`${repoPath}/pulls?state=open&per_page=100&page=1`]: firstPage,
      [`${repoPath}/pulls?state=open&per_page=100&page=2`]: [matching],
    }), semanticSha)
    assert.equal(url, matching.html_url)
    assert.equal(await findExistingProposal(context, reader({
      [`${repoPath}/pulls?state=open&per_page=100&page=1`]: [{
        ...matching, body: null, head: { ref: `automation/exam-catalog-${semanticSha}-12345` },
      }],
    }), semanticSha), matching.html_url)
    await assert.rejects(findExistingProposal(context, reader({
      [`${repoPath}/pulls?state=open&per_page=100&page=1`]: [{ ...matching, html_url: 'https://example.com/pull/73' }],
    }), semanticSha), /invalid existing proposal URL/)
    await assert.rejects(findExistingProposal(context, reader({
      [`${repoPath}/pulls?state=open&per_page=100&page=1`]: { incomplete: true },
    }), semanticSha), /could not be verified/)

    const workflow = await readFile(path.join(root, '.github', 'workflows', 'exam-catalog-freshness.yml'), 'utf8')
    const preflightJob = workflow.split(/\r?\n  preflight:\r?\n/)[1]?.split(/\r?\n  canary:\r?\n/)[0] ?? ''
    const canaryJob = workflow.split(/\r?\n  canary:\r?\n/)[1]?.split(/\r?\n  propose:\r?\n/)[0] ?? ''
    const proposalJob = workflow.split(/\r?\n  propose:\r?\n/)[1] ?? ''
    assert.match(preflightJob, /needs: detect/)
    for (const job of [canaryJob, proposalJob]) {
      assert.match(job, /needs: \[detect, preflight\]/)
      assert.match(job, /environment: exam-catalog-review/)
    }
    assert.doesNotMatch(canaryJob, /(?:contents|pull-requests): write/)
    assert.match(proposalJob, /if:.*needs\.detect\.outputs\.changed == 'true'.*inputs\.canary/)
    assert.match(proposalJob, /if: steps\.final\.outputs\.duplicate == 'false'/)
    assert.match(proposalJob, /if: steps\.postpush\.outputs\.duplicate == 'false'/)
  })
})
