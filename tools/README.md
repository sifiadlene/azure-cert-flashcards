---
title: Repository Tools
description: Commands for refreshing exam metadata and translating flashcard decks
ms.date: 2026-08-29
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
should be reviewed; there is no scheduled refresh or network dependency in
normal application builds.

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
