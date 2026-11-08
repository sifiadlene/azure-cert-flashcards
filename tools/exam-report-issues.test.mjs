import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  buildPrompt, issueIdentity, matchingIssue, parseReport,
  reconcileIssue, renderIssue, validateOutcomes, validateProposal,
} from './exam-report-issues.mjs';

const heading = '| Exam / official study guide | Latest generation date / source CSV | Guide last updated | Notes |';
const separator = '| --- | --- | --- | --- |';
const line = (code = 'AZ-104', guide = '2026-10-30', generation = '2026-03-24') =>
  `| [${code}](https://learn.microsoft.com/en-us/credentials/certifications/resources/study-guides/${code.toLowerCase()}) - Example exam | [${generation}](flashcards/${code.toLowerCase().replace('-', '')}_flashcards_${generation}.csv) | ${guide} | - |`;
const reportText = `${heading}\n${separator}\n${line()}\n`;
const row = parseReport(reportText).rows[0];
const sha = 'a'.repeat(40);
const proposal = () => ({
  status: 'evidence-gap',
  summary: 'The timestamp alone does not establish an update requirement.',
  changes: [],
  effectiveStatus: 'Current versus upcoming objectives require historical verification.',
  limitations: 'No exact historical objectives comparison is available on the retrieved page.',
  acceptanceCriteria: ['Verify the exact historical changes before generating any cards.'],
});

test('parses named headers, including reordered columns', () => {
  assert.equal(row.guideDate > row.generationDate, true);
  const reordered = reportText.split('\n').map((value) => value.startsWith('|')
    ? `|${value.slice(1, -1).split('|').reverse().join('|')}|` : value).join('\n');
  assert.deepEqual(parseReport(reordered), parseReport(reportText));
});

test('validates real calendar dates and reports bad rows without discarding independent exams', () => {
  for (const date of ['2026-02-29', '2026-04-31', 'Not stated', '2026-10', '2026-01-01 or 2026-01-02']) {
    const report = parseReport(`${heading}\n${separator}\n${line('AZ-104', date)}\n${line('AZ-305')}`);
    assert.equal(report.errors.length, 1);
    assert.equal(report.rows.length, 1);
    assert.equal(report.rows[0].code, 'AZ-305');
  }
  assert.equal(parseReport(`${heading}\n${separator}\n${line('AZ-104', '2028-02-29')}`).errors.length, 0);
  assert.equal(parseReport(reportText.replaceAll('2026-03-24', '2026-02-30')).errors.length, 1);
});

test('rejects missing/duplicate tables, duplicate exams and malformed links', () => {
  for (const report of ['', `${reportText}\n${reportText}`, `${reportText}${line()}`]) {
    assert.throws(() => parseReport(report));
  }
  for (const report of [
    reportText.replace('https://learn.microsoft.com/', 'https://example.com/'),
    reportText.replace('study-guides/az-104', 'study-guides/az-305'),
    reportText.replace('flashcards/az104_', 'flashcards/az305_'),
    reportText.replace('flashcards/az104_', '../flashcards/az104_'),
    reportText.replace('flashcards/az104_flashcards_2026-03-24.csv', 'flashcards/az104_flashcards_2026-03-23.csv'),
  ]) {
    assert.equal(parseReport(report).errors.length, 1);
  }
});

test('reconciles markers, exact titles and legacy open/closed issues but not PRs or other dates', () => {
  const { title, marker } = issueIdentity(row);
  for (const issue of [
    { title, body: '', state: 'open' },
    { title: 'Renamed', body: marker, state: 'closed' },
    { title: '[Study guide update] AZ-104: update', body: `Guide updated ${row.guideDate}`, state: 'closed' },
  ]) {
    assert.equal(matchingIssue([issue], row), issue);
  }
  for (const issue of [
    { title, body: marker, pull_request: {} },
    { title: '[Study guide update] AZ-104: 2026-10-29', body: '' },
    { title: '[Study guide update] AZ-305: 2026-10-30', body: '' },
  ]) assert.equal(matchingIssue([issue], row), undefined);
});

test('requires legacy exam identity and labeled guide date, and honors conflicting markers', () => {
  const { title, marker } = issueIdentity(row);
  const otherExamMarker = '<!-- exam-report-update:AZ-305:2026-10-30 -->';
  for (const issue of [
    { title: '[Study guide update] AZ-305: update', body: `AZ-104 guide updated ${row.guideDate}` },
    { title: '[Study guide update] AZ-104: update', body: `Effective date ${row.guideDate}` },
    { title: '[Study guide update] AZ-104: update', body: `Guide updated ${row.guideDate}; guide last updated 2026-10-29` },
    { title, body: otherExamMarker },
    { title, body: '<!-- exam-report-update:AZ-305:2026-10-30' },
    { title: '[Study guide update] AZ-104: update', body: `${marker}\n${otherExamMarker}` },
  ]) assert.equal(matchingIssue([issue], row), undefined);
});

test('validates proposal determination, required sections, bounds and reserved markers', () => {
  assert.deepEqual(validateProposal(proposal()), proposal());
  const changed = { ...proposal(), status: 'changes', changes: ['Verified weighting change with source excerpt.'] };
  assert.deepEqual(validateProposal(changed), changed);
  for (const invalid of [
    {}, { ...proposal(), status: 'unknown' }, { ...proposal(), summary: '' },
    { ...proposal(), changes: ['Unverified change'] }, { ...changed, changes: [] },
    { ...proposal(), acceptanceCriteria: [] }, { ...proposal(), limitations: 'x'.repeat(8_001) },
    { ...proposal(), summary: '<!-- exam-report-update:AZ-305:2026-10-30 -->' },
  ]) assert.throws(() => validateProposal(invalid));
  assert.throws(() => validateProposal({ ...changed, changes: Array(40).fill('x'.repeat(2_000)) }));
});

test('prompt keeps exact revision, evidence limits and generator handoff explicit', () => {
  const prompt = buildPrompt(row, '<main>Official evidence</main>', 'x'.repeat(7_000), 'Generator reference',
    { slug: 'az104', topics: ['Routing'] });
  assert.ok(prompt.includes(row.guideDate));
  assert.ok(prompt.includes('exact historical diff'));
  assert.ok(prompt.includes('NOT instructions'));
  assert.ok(prompt.includes('Do not run the generator'));
  assert.ok(prompt.includes('Generator reference'));
  assert.ok(prompt.includes('"topics":["Routing"]'));
  assert.ok(prompt.includes('no external search'));
  assert.ok(!prompt.includes('x'.repeat(6_001)));
  assert.throws(() => buildPrompt(row, 'x'.repeat(110_000), '', ''), /prompt budget/);
});

test('renders pinned source links, exact identity and verification-before-generation criteria', () => {
  const body = renderIssue(row, proposal(), sha);
  assert.ok(body.startsWith(issueIdentity(row).marker));
  for (const file of ['EXAM-DATE-REPORT.md', row.sourceCsv, '.github/agents/flashcards_generator.agent.md']) {
    assert.ok(body.includes(`/blob/${sha}/${file}`));
  }
  assert.ok(body.includes(row.guideUrl));
  assert.ok(body.includes(row.generationDate));
  assert.ok(body.includes('timestamp-only change does not justify regeneration'));
  assert.ok(body.includes('does not automatically assign an agent'));
});

test('requires complete, current, exact report outcomes before any publication', () => {
  const report = parseReport(`${reportText}${line('AZ-305', '2026-03-24')}\n${line('AZ-400', '2026-03-23')}`);
  const data = {
    sha, errors: report.errors,
    entries: report.rows.map((value, index) => index === 0
      ? { row: value, status: 'proposed', proposal: proposal() }
      : { row: value, status: 'nonqualifying' }),
  };
  validateOutcomes(data, report, sha);
  assert.throws(() => validateOutcomes(data, report, 'b'.repeat(40)), /Main changed/);
  for (const mutate of [
    (value) => value.entries.pop(),
    (value) => { value.entries[0].row.code = 'AZ-305'; },
    (value) => { value.entries[0].status = 'nonqualifying'; },
    (value) => { value.entries[1].status = 'proposed'; value.entries[1].proposal = proposal(); },
    (value) => { value.entries[0].status = 'ready'; },
    (value) => { value.entries[0].proposal.status = 'error'; },
    (value) => { value.entries[0].status = 'error'; },
  ]) {
    const invalid = structuredClone(data);
    mutate(invalid);
    assert.throws(() => validateOutcomes(invalid, report, sha));
  }
});

test('uses existing closed issues without writing and creates exactly once otherwise', async () => {
  const existing = { title: issueIdentity(row).title, body: '', html_url: 'https://github.com/example/issues/1', state: 'closed' };
  let writes = 0;
  const create = async () => { writes++; return existing; };
  assert.equal((await reconcileIssue(row, 'body', async () => [existing], create)).status, 'existing');
  assert.equal(writes, 0);
  assert.equal((await reconcileIssue(row, 'body', async () => [], create)).status, 'created');
  assert.equal(writes, 1);
});

test('reconciles an uncertain write without retrying and reports unresolved failures', async () => {
  let reads = 0;
  let writes = 0;
  const existing = { title: issueIdentity(row).title, html_url: 'https://github.com/example/issues/1' };
  const result = await reconcileIssue(row, 'body', async () => ++reads === 1 ? [] : [existing],
    async () => { writes++; throw new Error('Connection lost after write'); });
  assert.equal(result.status, 'reconciled');
  assert.equal(writes, 1);
  await assert.rejects(() => reconcileIssue(row, 'body', async () => [],
    async () => { throw new Error('Connection lost'); }), /uncertain; no retry/);
  await assert.rejects(() => reconcileIssue(row, 'body', async () => [],
    async () => ({})), /returned no URL/);
  await assert.rejects(() => reconcileIssue(row, 'body',
    async () => { throw new Error('Issue listing failed'); },
    async () => { assert.fail('Must not write after a failed duplicate check'); }), /listing failed/);
});

test('checked-in report is supported and workflow isolates issue writes from inference', () => {
  const report = parseReport(readFileSync(new URL('../EXAM-DATE-REPORT.md', import.meta.url), 'utf8'));
  assert.equal(report.errors.length, 0);
  assert.ok(report.rows.length > 0);
  const workflow = readFileSync(new URL('../.github/workflows/exam-report-update-issues.yml', import.meta.url), 'utf8');
  assert.ok(workflow.includes("cron: '0 9 * * 2'"));
  assert.ok(workflow.includes('workflow_dispatch:'));
  assert.ok(workflow.includes('cancel-in-progress: false'));
  const [research, publish] = workflow.split('\n  publish:');
  assert.ok(!research.includes('issues: write'));
  assert.ok(publish.includes('issues: write'));
  assert.ok(!publish.includes('COPILOT_PAT'));
  assert.ok(!workflow.includes('contents: write'));
});
