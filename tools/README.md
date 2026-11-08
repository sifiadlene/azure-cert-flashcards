---
title: Repository Tools
description: Commands for refreshing exam metadata and translating flashcard decks
ms.date: 2026-11-06
---

## Weekly README updates

[Update README](../.github/workflows/update-readme.yml) runs every Friday at
8am in `America/New_York`, automatically following daylight saving time.
It can also be started manually from Actions. Scheduled runs require the
workflow to be on the default branch and may start late under GitHub load.
GitHub disables scheduled workflows in public repositories after 60 days
without repository activity; re-enable the workflow from Actions if needed.

Before enabling it, add a repository Actions secret named `COPILOT_PAT`
containing a fine-grained personal access token with the **Copilot Requests**
permission and an account with Copilot access. Classic PATs are not supported.
Under **Settings > Actions > General > Workflow permissions**, allow GitHub
Actions to create pull requests. Inference uses the token owner's Copilot
quota and may incur usage charges according to their plan.

The read-only inference job supplies tracked file paths and bounded excerpts
from documentation, manifests, catalog metadata, workflows, and source code.
It does not send local settings, environment files, or deck contents.
Copilot has no tool access and returns a complete README proposal. Safeguards
reject incomplete output, missing sections, and invalid relative links.

A separate write-enabled job opens or updates the draft PR on
`automation/weekly-readme`, committing only `README.md`. Unchanged output
produces no PR; errors fail the run rather than publishing a fallback.
Concurrent README edits invalidate the proposal. Review factual claims,
counts, commands, and links before merging; the workflow never auto-merges.
Disable the workflow from Actions to pause it.

Run the offline safeguards with:

```bash
node --test tools/readme-update.test.mjs
```

## Weekly exam report issues

[Exam report update issues](../.github/workflows/exam-report-update-issues.yml)
runs every Tuesday at **09:00 UTC**, matching the original local automation,
and supports manual runs from Actions. It must be merged to the default branch
before its schedule can run. Scheduled runs can be delayed, and GitHub disables
scheduled workflows in public repositories after 60 days without activity.

Reuse the `COPILOT_PAT` Actions secret described above: a fine-grained PAT with
**Copilot Requests** permission and Copilot access. No issue-write permission
is needed on that PAT. Inference consumes the token owner's Copilot quota.
Issue creation uses the separate, repository-scoped `GITHUB_TOKEN` with
`issues: write`; this workflow needs no content-write or PR permission.

The read-only job reads the latest committed `main` report, generator
reference, deck catalog and relevant source CSVs through GitHub, pinned to one revision.
It compares the report's named date columns as real calendar dates, selecting
only exams whose guide-update date is strictly newer than their generation
date. Equal/earlier dates are skipped. It fetches the complete main content of
each unmatched exam's official English Microsoft Learn guide, including any
on-page change log and previous/current objectives. Copilot receives that
evidence, the generator reference and a bounded CSV excerpt with no tool
access; it cannot execute the generator, search the web, or publish.

Unlike the interactive local job, this workflow does not perform external
search or retrieve off-page historical revisions. Missing exact historical
comparisons must be disclosed, not guessed. A qualifying timestamp alone
does not establish an outdated deck. Such an issue requires evidence
verification before generation; confirmed timestamp-only changes do not
justify regeneration. Full guide evidence that exceeds the inference budget,
failed requests and malformed output are explicit errors, not speculative
issues. Every generated determination needs human review for factual accuracy.

The publishing job validates all outcomes against the committed report and
refuses stale proposals if `main` has changed. Before each issue write, it
paginates both open and closed issues and checks exact titles, deterministic
markers and legacy `[Study guide update]` issues for the same exam/date.
Matching issues are reported without comments, reopening or reassignment.
Uncertain writes are reconciled once without automatically retrying creation.
Workflow concurrency serializes runs; pause the original local **Exam report
update issues** automation once this replacement is merged and configured to
avoid two independent publishers. Leave the other local automations unchanged.

New issues contain comparison dates, pinned report/source/generator links,
official evidence, verified changes or evidence gaps, effective-date status,
acceptance criteria and an implementation handoff to `flashcards_generator`.
The workflow never generates decks, edits tracked files, commits, pushes,
opens PRs, assigns agents or merges. Independent exams continue after
row-specific failures, but any error makes the final run fail with an explicit
Actions summary. Proposals are retained as an Actions artifact for seven days;
issues are the durable reconciliation record.

Run the offline safeguards with:

```bash
node --test tools/exam-report-issues.test.mjs
```

Disable the Actions workflow to pause it. Do not disable the original local
automation before the replacement is published and its prerequisites are ready.

## Microsoft Learn exam catalog

The canonical snapshot is stored in
`catalog/microsoft-learn-practice-assessments.json`. It contains the approved
49-entry Microsoft Learn Availability catalog retrieved on 2026-08-29.

Refresh the snapshot from the live Availability table:

```bash
node tools/refresh-exam-catalog.mjs
```

For a deterministic offline refresh, supply the checked-in fixture and the
snapshot timestamp:

```bash
node tools/refresh-exam-catalog.mjs \
   --input tools/fixtures/microsoft-learn-practice-assessments.html \
   --retrieved-at 2026-08-29T00:00:00.000Z
```

The parser accepts only HTTPS links on Microsoft Learn and Microsoft AI Skills
Navigator. It fails when the Availability heading or table shape changes,
codes repeat, links are malformed, or a refresh produces fewer entries than
the checked-in catalog.

Generate the shared supported-code set and runtime copies:

```bash
cd web
npm run build:data
```

Validate parser behavior and detect drift across the canonical, web, and API
copies without making a network request:

```bash
node --test tools/exam-catalog.test.mjs
node tools/validate-exam-data.mjs
```

Run the offline parser test before a live refresh. After a live refresh, review
the diff for source URL, title, retrieval timestamp, and unexpected removals.
Then run `npm run build:data` from `web` and the drift validator. Commit the
canonical file, `web/public/data` copies, and `api/data` copies in the same
change.

The supported set is derived only from `web/public/data/exams.json`. Requestable
exams are the catalog entries whose codes are absent from that set. The current
baseline contains 14 supported codes and 37 requestable catalog entries.

The 49 catalog entries and 14 supported codes overlap on 12 codes. Two local
decks are not present in the current Learn table, so the requestable count is
49 minus 12, not 49 minus 14. A lower live result is rejected to protect the
snapshot from accidental source-page changes.

## Exam date report

[EXAM-DATE-REPORT.md](../EXAM-DATE-REPORT.md) covers every exam with a local
source deck. It lists the latest repository-declared generation date, the
official English study guide's displayed update date, and published
objective-effective dates.

The generation date comes from the selected CSV filename, not a JSON build
timestamp or filesystem modification time. The report and website share deck
selection rules: newest filename date, then largest optional filename count,
then greatest filename as a tie-breaker. Report commands reject drift between
the selected CSVs and `web/public/data/exams.json`. If needed, regenerate the
manifest with `cd web && npm run build:data` and review its changes first.

Run the offline tests, then deliberately refresh official guide metadata and
regenerate the report from the repository root (Node.js 22+):

```bash
node --test tools/exam-date-report.test.mjs
node tools/refresh-study-guide-dates.mjs
node tools/generate-exam-date-report.mjs
node tools/generate-exam-date-report.mjs --check
```

The refresh requests only the official Microsoft Learn English study-guide
URLs. HTTP errors, redirects, missing update markup, unexpected skills
headings, or an incorrect exam title fail explicitly. All guides must parse
and validate before `catalog/study-guide-dates.json` is atomically replaced;
a failed refresh preserves the existing snapshot.

The snapshot records the displayed "Last updated on" date and timestamp,
`updated_at` metadata, objective date precision, source text, guide titles and
URLs, and retrieval time. The displayed date is authoritative for the report:
`ms.date` is not substituted, and metadata timestamps may differ from the
displayed date. Objective dates come from "Skills measured as of" or "Skills
at a glance as of" headings. Prior-version headings are excluded. Undated
skills headings yield "Not stated"; month-only dates remain `YYYY-MM`.
Upcoming objectives are labeled relative to snapshot retrieval time. Multiple
published objective versions are retained, not treated as simultaneously
current. A guide-page update does not establish whether a deck's content is
outdated or aligned.

For reproducible offline refresh, supply a directory containing one saved
official HTML page per supported exam (`az-104.html`, `gh-300.html`, etc.) and
the original retrieval timestamp:

```bash
node tools/refresh-study-guide-dates.mjs \
   --input /path/to/saved-guides \
   --retrieved-at 2026-11-05T19:24:06.472Z
```

`tools/fixtures/study-guide.html` is a minimal parser fixture, not a complete
15-exam refresh input. Normal report generation and `--check` use only local
files and never fetch pages. They do not update retrieval time. Review and
commit the snapshot and report together after refresh. Link and date changes
should be reviewed; normal application builds have no network dependency.

### Scheduled report refresh

[Exam date report refresh](../.github/workflows/refresh-exam-date-report.yml)
ports the local automation to GitHub Actions. It runs every Monday at 09:00 UTC
and supports manual runs from Actions. This matches the local automation's
Monday 09:00 schedule on the UTC host; Actions cron schedules use UTC.
The workflow must be merged into the default branch before scheduled runs
can start. Scheduled runs may be delayed, and GitHub disables schedules in
public repositories after 60 days without repository activity.

The workflow checks out the current default branch, uses Node.js 22, and runs
the refresh, generation, tests, and drift check in that order without installing
project dependencies. It rejects changes outside
`catalog/study-guide-dates.json` and `EXAM-DATE-REPORT.md`. Unchanged output
creates no branch or PR; failed refreshes or validation publish nothing.
Successful changes are committed to a unique branch per run/attempt and opened
as a new PR against the default branch. Publication failures inspect remote
state without retrying. It never modifies existing PRs, force-pushes, enables
auto-merge, or merges.

No personal token or Copilot subscription is required. The job uses
`GITHUB_TOKEN` with contents and pull-request write permissions. Under
**Settings > Actions > General > Workflow permissions**, allow GitHub Actions
to create pull requests; organization policy may restrict this setting.
The existing local automation is not disabled by this workflow. Disable one
of the two schedules when activating this replacement to avoid duplicate
refresh PRs. Disable the Actions workflow from Actions to pause it.

## Translation tools

This directory contains scripts for translating flashcard decks into other languages.

## `translate-decks.mjs`

Translates all English JSON deck files to French using the [Azure AI Translator](https://learn.microsoft.com/en-us/azure/ai-services/translator/) Text API.

### Prerequisites

- **Node.js 20+**
- An **Azure AI Translator** resource (free tier F0 supports 2 million characters/month)

### Azure Setup

1. Create a Translator resource in the [Azure Portal](https://portal.azure.com):
   - Resource type: **Translator** (under Azure AI services)
   - Pricing tier: **F0** (free, 2M chars/month) or **S1** ($10/1M chars) for production
2. Copy the **Key** and **Region** from the resource's "Keys and Endpoint" page

### Running the Script

First, generate the English JSON decks (if not already done):
```bash
cd web && npm run build:data
```

Then run the translation script from the repository root:

```bash
# Using environment variables (recommended)
AZURE_TRANSLATOR_KEY=your_key AZURE_TRANSLATOR_REGION=eastus node tools/translate-decks.mjs

# Using CLI arguments
node tools/translate-decks.mjs --key your_key --region eastus

# Translate only a single deck
node tools/translate-decks.mjs --key your_key --region eastus --deck ai900

# Re-translate existing files (overwrite)
node tools/translate-decks.mjs --key your_key --region eastus --force
```

### Output

The script writes `{slug}-fr.json` files alongside the English decks in `web/public/data/decks/`:

```
web/public/data/decks/
├── ai102.json        # English (generated by build:data)
├── ai102-fr.json     # French  (generated by this script)
├── ai900.json
├── ai900-fr.json
...
```

The French JSON files have the same schema as the English originals. All translatable fields are translated:

| Field | Type | Translated |
|-------|------|-----------|
| `exam.title` | plain text | ✅ |
| `promptHtml` | HTML | ✅ (tags preserved) |
| `options[].label` | plain text | ✅ |
| `correctLabel` | plain text | ✅ |
| `rationaleHtml` | HTML | ✅ (tags preserved) |
| `extraHtml` | HTML | ✅ (tags preserved) |
| `id`, `domain`, `topic`, `tags`, `correctOption` | identifiers | ❌ (kept as-is) |

### Cost Estimate

With the F0 free tier (2M characters/month), translating all 7 decks (~700 questions) is effectively **free**.

Approximate character counts per full run:

| Deck | ~Characters |
|------|------------|
| AI-900 (100 questions) | ~90k |
| AI-102 (100 questions) | ~95k |
| AZ-104 (100 questions) | ~100k |
| AZ-204 (100 questions) | ~100k |
| AZ-305 (100 questions) | ~100k |
| AZ-500 (100 questions) | ~95k |
| GH-300 (100 questions) | ~85k |
| **Total** | **~665k** |

This is well within the F0 free monthly quota. At S1 pricing ($10/1M chars), the total cost would be approximately **$6-7** for all 7 decks.

### After Translation

After generating French deck files, commit them and redeploy the site:

```bash
git add web/public/data/decks/*-fr.json
git commit -m "feat: add French flashcard translations"
git push
```

The web app's language switcher will automatically detect and load French decks when the user switches to French.

### Reviewing Translations

Machine translations should be reviewed for technical accuracy, especially:

- Azure-specific terminology (e.g., service names, resource types)
- Certification exam concepts
- Technical acronyms (usually preserved unchanged by the API)

Spot-check 10–20 cards per deck before publishing. Pay particular attention to cards in domains with heavy technical vocabulary (e.g., AZ-104 IdentityGovernance, AZ-500 security domains).

### Adding More Languages

To translate into additional languages (e.g., Spanish), modify `TARGET_LANGUAGE` in the script or extend it to accept a `--to` argument. Azure Translator supports [100+ languages](https://learn.microsoft.com/en-us/azure/ai-services/translator/language-support).
