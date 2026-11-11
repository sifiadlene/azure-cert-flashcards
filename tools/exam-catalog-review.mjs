import { appendFile, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import { fileURLToPath, pathToFileURL } from 'node:url'
import {
  SOURCE_PAGE_URL,
  buildCatalogCandidate,
  createReviewReport,
  readJson,
  validateCatalog,
  validateSourceUrl,
} from './exam-catalog.mjs'

const toolsDirectory = path.dirname(fileURLToPath(import.meta.url))
const repositoryDirectory = path.resolve(toolsDirectory, '..')
const catalogPath = path.join(repositoryDirectory, 'catalog', 'microsoft-learn-practice-assessments.json')
const retirementUrl = 'https://learn.microsoft.com/en-us/credentials/support/retired-certification-exams'
const environmentName = 'exam-catalog-review'
const reviewerLogin = 'sifiadlene'
const shaPattern = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/

function hasExactKeys(value, keys) {
  return value && typeof value === 'object'
    && isDeepStrictEqual(Object.keys(value).sort(), [...keys].sort())
}

export function verifyReviewReport(existingCatalog, candidateBytes, report, baseSha) {
  const candidate = validateCatalog(JSON.parse(candidateBytes.toString()))
  if (!hasExactKeys(candidate, ['schemaVersion', 'exams'])
    || candidate.exams.some((exam) => !hasExactKeys(exam, ['code', 'title', 'sourceUrl', 'sourcePageUrl', 'retrievedAt']))) {
    throw new Error('Candidate contains unexpected catalog fields')
  }
  const expected = createReviewReport(existingCatalog, candidate, report?.checkedAt, baseSha, candidateBytes)
  if (!isDeepStrictEqual(report, expected)) {
    throw new Error('Candidate, review report or base SHA does not match')
  }
  if (!isDeepStrictEqual(candidate, buildCatalogCandidate(existingCatalog, candidate))) {
    throw new Error('Candidate changes an unchanged entry or its retrieval timestamp')
  }
  const changedCodes = new Set([...report.added.map(({ code }) => code), ...report.changed.map(({ code }) => code)])
  if (candidate.exams.some((exam) => changedCodes.has(exam.code) && exam.retrievedAt !== report.checkedAt)) {
    throw new Error('Changed entries must use the source check timestamp')
  }
  return {
    candidate,
    report,
    hasChanges: report.added.length + report.removed.length + report.changed.length > 0,
  }
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character])
}

function escapeText(value) {
  return escapeHtml(String(value).replace(/\s+/g, ' '))
    .replace(/[\\`*_{}\[\]()#+.!|~-]/g, (character) => `&#${character.codePointAt(0)};`)
}

function renderEntry(entry) {
  const sourceUrl = validateSourceUrl(entry.sourceUrl)
  if (entry.sourcePageUrl !== SOURCE_PAGE_URL) {
    throw new Error('Unexpected source page in review entry')
  }
  return `<code>${escapeHtml(entry.code)}</code> - ${escapeText(entry.title)}<br>`
    + `Assessment: <a href="${escapeHtml(sourceUrl)}">${escapeHtml(sourceUrl)}</a><br>`
    + `Source: <a href="${escapeHtml(entry.sourcePageUrl)}">Microsoft Learn availability list</a>`
}

export function renderReviewSummary(report) {
  const lines = [
    '## Microsoft Learn practice-assessment catalog',
    '',
    `Checked: \`${report.checkedAt}\`  `,
    `Base commit: \`${report.baseSha}\`  `,
    `Candidate SHA-256: \`${report.candidateSha256}\`  `,
    `Semantic SHA-256: \`${report.semanticSha256}\``,
    '',
  ]
  if (report.added.length + report.removed.length + report.changed.length === 0) {
    lines.push('No semantic changes; the committed catalog was not modified.', '')
    return lines.join('\n')
  }
  lines.push('Review the exact candidate and its source links before approving a proposal.', '')
  if (report.added.length) {
    lines.push('### Added to the source', '')
    for (const entry of report.added) lines.push(`- ${renderEntry(entry)}`)
    lines.push('')
  }
  if (report.removed.length) {
    lines.push('### Absent from the source', '')
    lines.push(`Absence from the practice-assessment list does not establish retirement. Check the [official exam retirement list](${retirementUrl}).`, '')
    for (const entry of report.removed) lines.push(`- ${renderEntry(entry)}`)
    lines.push('')
  }
  if (report.changed.length) {
    lines.push('### Changed in the source', '')
    for (const change of report.changed) {
      lines.push(`- <strong>${escapeHtml(change.code)}</strong><br>Before: ${renderEntry(change.before)}<br>After: ${renderEntry(change.after)}`)
    }
    lines.push('')
  }
  return lines.join('\n')
}

function validateRunContext(context) {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(context.repository ?? '')
    || context.repository.split('/').some((part) => part === '.' || part === '..')
    || !/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(context.defaultBranch ?? '')
    || context.defaultBranch.includes('..')
    || context.ref !== `refs/heads/${context.defaultBranch}`) {
    throw new Error('The run must use the repository default branch')
  }
  if (context.attempt !== '1' || !/^[1-9]\d*$/.test(context.runId ?? '')) {
    throw new Error('Use a new workflow run; rerun attempts are not eligible')
  }
  if (!shaPattern.test(context.sha ?? '') || context.baseSha !== context.sha) {
    throw new Error('The detection base does not match the workflow revision')
  }
  let server
  try {
    server = new URL(context.serverUrl)
  } catch {
    throw new Error('GitHub server URL is unavailable')
  }
  if (server.protocol !== 'https:' || server.username || server.password
    || server.pathname !== '/' || server.search || server.hash) {
    throw new Error('GitHub server URL is invalid')
  }
}

function repositoryPath(context) {
  return `/repos/${context.repository.split('/').map(encodeURIComponent).join('/')}`
}

export async function preflight(context, githubGet) {
  validateRunContext(context)
  const repository = repositoryPath(context)
  const environment = `${repository}/environments/${encodeURIComponent(environmentName)}`
  const [repo, branch, protection, policies] = await Promise.all([
    githubGet(repository),
    githubGet(`${repository}/branches/${encodeURIComponent(context.defaultBranch)}`),
    githubGet(environment),
    githubGet(`${environment}/deployment-branch-policies?per_page=100&page=1`),
  ])
  if (repo?.default_branch !== context.defaultBranch || branch?.commit?.sha !== context.baseSha) {
    throw new Error('The default branch changed; start a new review run')
  }
  if (protection?.name !== environmentName || !Number.isSafeInteger(protection.id) || protection.id <= 0
    || protection.deployment_branch_policy?.protected_branches !== false
    || protection.deployment_branch_policy?.custom_branch_policies !== true
    || policies?.total_count !== 1 || !Array.isArray(policies.branch_policies)
    || policies.branch_policies.length !== 1
    || policies.branch_policies[0]?.type !== 'branch'
    || policies.branch_policies[0]?.name !== context.defaultBranch) {
    throw new Error('Catalog review environment or default-branch protection is missing or unsafe')
  }
  const rules = Array.isArray(protection.protection_rules)
    ? protection.protection_rules.filter((rule) => rule?.type === 'required_reviewers')
    : []
  const reviewers = rules[0]?.reviewers
  const reviewer = Array.isArray(reviewers) ? reviewers[0] : undefined
  if (rules.length !== 1 || rules[0].prevent_self_review !== false
    || reviewers?.length !== 1 || reviewer?.type !== 'User'
    || typeof reviewer.reviewer?.login !== 'string'
    || reviewer.reviewer.login.toLowerCase() !== reviewerLogin
    || !Number.isSafeInteger(reviewer.reviewer?.id) || reviewer.reviewer.id <= 0) {
    throw new Error('Catalog review environment must require only the designated user and allow self-review')
  }
  return { environmentId: protection.id, reviewerId: reviewer.reviewer.id }
}

export function verifyApprovalHistory(history, gate) {
  if (!Array.isArray(history)) throw new Error('Workflow approval history is unavailable')
  const reviews = history.filter((review) => Array.isArray(review?.environments)
    && review.environments.some((environment) => environment?.id === gate.environmentId
      && environment.name === environmentName))
  const review = reviews[0]
  if (reviews.length !== 1 || review?.state !== 'approved'
    || review.user?.id !== gate.reviewerId || typeof review.user?.login !== 'string'
    || review.user.login.toLowerCase() !== reviewerLogin) {
    throw new Error('The designated user has not approved this run for the catalog review environment')
  }
}

function proposalUrl(context, pull) {
  const server = new URL(context.serverUrl)
  const url = new URL(pull.html_url)
  if (server.protocol !== 'https:' || server.username || server.password
    || server.pathname !== '/' || server.search || server.hash
    || url.origin !== server.origin || url.username || url.password || url.search || url.hash
    || !Number.isSafeInteger(pull.number) || pull.number <= 0
    || url.pathname.toLowerCase() !== `/${context.repository}/pull/${pull.number}`.toLowerCase()) {
    throw new Error('GitHub returned an invalid existing proposal URL')
  }
  return url.href
}

export async function findExistingProposal(context, githubGet, semanticSha) {
  if (!/^[a-f0-9]{64}$/.test(semanticSha)) throw new Error('Invalid semantic fingerprint')
  const marker = `<!-- exam-catalog-semantic-sha256:${semanticSha} -->`
  const branchPrefix = `automation/exam-catalog-${semanticSha}-`
  for (let page = 1; page <= 100; page += 1) {
    const pulls = await githubGet(`${repositoryPath(context)}/pulls?state=open&per_page=100&page=${page}`)
    if (!Array.isArray(pulls)) throw new Error('Open pull requests could not be verified')
    for (const pull of pulls) {
      if (pull?.state !== 'open' || (pull.body !== null && typeof pull.body !== 'string')
        || typeof pull.head?.ref !== 'string') {
        throw new Error('Open pull request data is incomplete')
      }
      const branchSuffix = pull.head.ref.startsWith(branchPrefix) ? pull.head.ref.slice(branchPrefix.length) : ''
      if (pull.body?.includes(marker) || /^[1-9]\d*$/.test(branchSuffix)) {
        return proposalUrl(context, pull)
      }
    }
    if (pulls.length < 100) return null
  }
  throw new Error('Too many open pull requests to verify duplicate proposals safely')
}

export async function authorizeProposal(context, githubGet, input) {
  validateRunContext(context)
  const reviewed = verifyReviewReport(input.base, input.candidateBytes, input.report, context.baseSha)
  const fresh = verifyReviewReport(input.base, input.freshCandidateBytes, input.freshReport, context.baseSha)
  if (!/^[a-f0-9]{64}$/.test(input.expectedCandidateSha256 ?? '')
    || !/^[a-f0-9]{64}$/.test(input.expectedSemanticSha256 ?? '')
    || reviewed.report.candidateSha256 !== input.expectedCandidateSha256
    || reviewed.report.semanticSha256 !== input.expectedSemanticSha256) {
    throw new Error('Candidate does not match the detection run')
  }
  if (!input.canary && !reviewed.hasChanges) {
    throw new Error('An unchanged catalog cannot create a proposal')
  }
  if (fresh.report.semanticSha256 !== reviewed.report.semanticSha256) {
    throw new Error('The upstream catalog changed after review; start a new run')
  }
  const gate = await preflight(context, githubGet)
  if (gate.environmentId !== input.environmentId || gate.reviewerId !== input.reviewerId) {
    throw new Error('The protected environment changed after preflight')
  }
  const history = await githubGet(`${repositoryPath(context)}/actions/runs/${context.runId}/approvals`)
  verifyApprovalHistory(history, gate)
  const existingUrl = input.canary ? null : await findExistingProposal(context, githubGet, reviewed.report.semanticSha256)
  return { reviewed, existingUrl }
}

function pullRequestBody(context, report) {
  return [
    'Refreshes the Microsoft Learn practice-assessment snapshots after explicit review.',
    '',
    `<!-- exam-catalog-semantic-sha256:${report.semanticSha256} -->`,
    `Workflow run: ${context.serverUrl}/${context.repository}/actions/runs/${context.runId}`,
    '',
    'Only the canonical and web catalog snapshots are changed. PR checks created with `GITHUB_TOKEN` may require approval.',
    'Review source links and removals before merging; this workflow does not merge or deploy.',
    '',
    renderReviewSummary(report),
  ].join('\n')
}

function githubContext() {
  return {
    repository: process.env.GITHUB_REPOSITORY,
    defaultBranch: process.env.DEFAULT_BRANCH,
    ref: process.env.GITHUB_REF,
    sha: process.env.GITHUB_SHA,
    baseSha: process.env.DETECTION_BASE_SHA,
    runId: process.env.GITHUB_RUN_ID,
    attempt: process.env.GITHUB_RUN_ATTEMPT,
    serverUrl: process.env.GITHUB_SERVER_URL,
  }
}

function githubReader() {
  const apiUrl = process.env.GITHUB_API_URL
  const token = process.env.GH_TOKEN
  if (!apiUrl || !token) throw new Error('GitHub API URL or read token is unavailable')
  const api = new URL(apiUrl)
  if (api.protocol !== 'https:' || api.username || api.password || api.search || api.hash) {
    throw new Error('GitHub API URL is invalid')
  }
  return async (endpoint) => {
    const response = await fetch(`${apiUrl.replace(/\/$/, '')}${endpoint}`, {
      headers: {
        accept: 'application/vnd.github+json',
        authorization: `Bearer ${token}`,
        'x-github-api-version': '2022-11-28',
      },
      redirect: 'error',
      signal: AbortSignal.timeout(30_000),
    })
    if (!response.ok) throw new Error(`GitHub read failed for ${endpoint} (HTTP ${response.status})`)
    return response.json()
  }
}

async function main(arguments_) {
  const [command, ...args] = arguments_
  if (command === 'summary' && (args.length === 4 || args.length === 5)) {
    const [candidatePath, reportPath, baseSha, summaryPath, outputPath] = args
    const [existingCatalog, candidateBytes, report] = await Promise.all([
      readJson(catalogPath),
      readFile(candidatePath),
      readJson(reportPath),
    ])
    const reviewed = verifyReviewReport(existingCatalog, candidateBytes, report, baseSha)
    await appendFile(summaryPath, renderReviewSummary(reviewed.report), 'utf8')
    if (outputPath) {
      await appendFile(outputPath, `candidate_sha256=${reviewed.report.candidateSha256}\nsemantic_sha256=${reviewed.report.semanticSha256}\n`, 'utf8')
    }
    return
  }
  if (command === 'preflight' && args.length === 1) {
    const context = githubContext()
    const gate = await preflight(context, githubReader())
    await appendFile(args[0], `environment_id=${gate.environmentId}\nreviewer_id=${gate.reviewerId}\n`, 'utf8')
    return
  }
  if (command === 'authorize' && args.length === 10) {
    const [basePath, candidatePath, reportPath, freshCandidatePath, freshReportPath,
      environmentId, reviewerId, mode, outputPath, bodyPath] = args
    if (!['canary', 'proposal'].includes(mode)) throw new Error('Invalid authorization mode')
    const [base, candidateBytes, report, freshCandidateBytes, freshReport] = await Promise.all([
      readJson(basePath), readFile(candidatePath), readJson(reportPath),
      readFile(freshCandidatePath), readJson(freshReportPath),
    ])
    const context = githubContext()
    const result = await authorizeProposal(context, githubReader(), {
      base, candidateBytes, report, freshCandidateBytes, freshReport,
      environmentId: Number(environmentId), reviewerId: Number(reviewerId), canary: mode === 'canary',
      expectedCandidateSha256: process.env.DETECTION_CANDIDATE_SHA256,
      expectedSemanticSha256: process.env.DETECTION_SEMANTIC_SHA256,
    })
    if (mode === 'proposal') await writeFile(bodyPath, pullRequestBody(context, result.reviewed.report), 'utf8')
    const duplicate = result.existingUrl ? `true\nduplicate_url=${result.existingUrl}` : 'false'
    await appendFile(outputPath, `duplicate=${duplicate}\nsemantic_sha256=${result.reviewed.report.semanticSha256}\n`, 'utf8')
    return
  }
  throw new Error('Invalid exam catalog review command or arguments')
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
}
