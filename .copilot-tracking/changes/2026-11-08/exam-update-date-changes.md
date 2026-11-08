# RPI Changes: Exam update date

## Metadata

* Task ID: `exam-update-date`
* Related plan: [.copilot-tracking/plans/2026-11-08/exam-update-date-plan.md](../../plans/2026-11-08/exam-update-date-plan.md)
* Implementation date: 2026-11-08

## Execution Status

* Status: Complete.
* Declared invocation scope: full plan.
* Completed scope markers: P01, P01-T01, P02, P02-T01, P02-T02.
* All remaining active-plan markers: none.
* Status basis: every in-scope task has an implementation and validation record.

## Execution Summary

The canonical study-guide snapshot is validated and synchronized, and both setup views display the selected deck and study-guide page dates. Focused regression coverage verifies date semantics, localization, failure handling and existing practice flows.

## Completed Work

### Public study-guide snapshot and refresh

* Related phase or task: P01-T01.
* Files: [tools/sync-study-guide-public.mjs](../../../tools/sync-study-guide-public.mjs), [tools/exam-date-report.test.mjs](../../../tools/exam-date-report.test.mjs), [web/public/data/study-guide-dates.json](../../../web/public/data/study-guide-dates.json), [.github/workflows/refresh-exam-date-report.yml](../../../.github/workflows/refresh-exam-date-report.yml), [.github/workflows/api-infrastructure.yml](../../../.github/workflows/api-infrastructure.yml), and [.github/workflows/deploy-site.yml](../../../.github/workflows/deploy-site.yml).
* Behavior: The public snapshot is a byte-identical copy of a validated canonical snapshot; drift or malformed data fails CI. Weekly refresh PRs include the copy, and both deployment paths check it without changing deck versions or translations.
* Validation: Passed `node --test --test-reporter=dot tools/exam-date-report.test.mjs` and `node tools/sync-study-guide-public.mjs --check`. Tests cover synchronization, missing/mismatched copies, malformed inputs and workflow wiring. The existing report comparison now normalizes checkout line endings, preserving cross-platform test behavior.

### Localized dates in both setup views

* Related phase or task: P02-T01.
* Files: [web/src/ExamDates.tsx](../../../web/src/ExamDates.tsx), [web/src/studyGuideDates.ts](../../../web/src/studyGuideDates.ts), [web/src/App.tsx](../../../web/src/App.tsx), [web/src/challenge/ChallengeViews.tsx](../../../web/src/challenge/ChallengeViews.tsx), [web/src/App.css](../../../web/src/App.css), [web/src/i18n/locales/en.json](../../../web/src/i18n/locales/en.json), [web/src/i18n/locales/fr.json](../../../web/src/i18n/locales/fr.json), and [web/README.md](../../../web/README.md).
* Behavior: Selected exams show independently labelled deck and official guide-page dates, formatted in the active language without timezone shifts. Missing entries are unavailable; invalid data, including an empty snapshot, shows an error without blocking practice. Canonical official links are validated.
* Validation: Web lint and TypeScript checks passed. Browser checks exercised both views, English and French, changing exams, a negative UTC offset, a 320-pixel viewport, and missing, malformed, and failed snapshots while starting practice. Four unit tests passed again after correcting empty-snapshot validation.
* Design-hook observations concern unchanged pre-existing CSS rules; the new date styles do not introduce those patterns, so unrelated styles were left intact.

### Date and practice regression coverage

* Related phase or task: P02-T02.
* Files: [web/src/studyGuideDates.test.ts](../../../web/src/studyGuideDates.test.ts) and [web/tests/e2e/exam-dates.spec.ts](../../../web/tests/e2e/exam-dates.spec.ts).
* Behavior: Automated coverage checks code matching, validation, localized calendar dates, unavailable and error states including empty snapshots, both setup modes, keyboard navigation, themes, and narrow layouts.
* Validation: Four focused Vitest tests, eight date-display Playwright tests, and nine existing solo and challenge browser tests passed. The normal Windows Playwright startup failed on Unix-only environment syntax; equivalent session-only services and configuration were used successfully.

## Implementation-Time Plan Updates

### Shared date-test guidance

* Affected plan area: P02-T02.
* What changed: Added task-local pointers to the shared date component and its loader/formatting helpers.
* Why: These files were created by P02-T01 and are the targets of the dependent tests.
* User decision: none; implementation-only annotation.

### Windows browser-test execution

* Affected plan area: P02-T02.
* What changed: Use equivalent locally started test services and a session-only Playwright configuration on Windows; leave the repository's existing Unix-oriented test setup unchanged.
* Why: The configured API command uses `NODE_ENV=test` shell syntax, which Windows cannot execute. The plan explicitly permits recording platform-specific limitations.
* Triggering evidence: The targeted Playwright command failed at web-server startup after dependencies were installed.
* User decision: none; this changes validation execution only, not product behavior.
* Reconciliation: Keep the same Chromium project, test files, API adapter, proxy and timezone assertions; record the exact outcome.

### Empty-snapshot consistency

* Affected plan area: P02-T01 and P02-T02.
* Discovery: The public snapshot check rejects an empty exam array, but browser validation and the missing-entry test treated one as valid.
* Action: Treated an empty snapshot as an error and derived the missing-entry fixture from a full canonical entry. The publisher validator accepted the filtered snapshot, and unit and browser coverage passed.
* User decision: none; this enforces the existing invalid-data requirement.

## Business Alignment

* None; no BRD, PRD, or ADR requirement is cited by the plan.

## Validation Record

| Check | Scope | Status | Evidence or reason |
|---|---|---|---|
| Offline report, sync, and workflow tests | P01-T01 | Passed | 19 tests passed; the working-tree public copy matches the canonical snapshot. |
| Unit and browser behavior tests | P02-T02 | Passed | Four unit tests, eight date-display browser tests, and nine existing solo/challenge browser tests passed. The normal Windows Playwright startup failed on Unix shell syntax; equivalent session-only services were used. |
| `npm run validate:data`, lint, and deploy-equivalent build | P02-T02 | Passed | Validation passed after the same canonical API-data copy used by CI; lint, TypeScript and Vite build passed. |

## Pre-Review Reconciliation

* Plan markers and task-local context: current; all in-scope items are checked.
* Completed-work entries and handoff prose: current.
* Validation, blockers, remaining work, and follow-up items: current; no open blockers or active-plan work.
* Review readiness: ready; the Windows Playwright startup limitation and successful equivalent run are recorded.

## Blockers

* None identified.

## Remaining Work

* None.

## Follow-Up Items

* Canonical list: [.copilot-tracking/plans/2026-11-08/exam-update-date-plan.md](../../plans/2026-11-08/exam-update-date-plan.md), `## Follow-Up Items`.
* None.

## Return-to-Caller State

* Implementation execution status: Complete, full-plan scope; P01, P01-T01, P02, P02-T01 and P02-T02 completed.
* Validation coverage: offline snapshot checks, unit tests, browser tests, deck parity, lint and deploy-equivalent build passed; normal Windows Playwright startup required an equivalent local harness.
* Blockers: none identified.
* Current plan updates: P02-T02 has shared-component guidance; Windows browser checks use equivalent session-only services because the existing startup command is Unix-specific.
* Business alignment entries: none.
* Follow-up items: none.
* Planning and critique state: ready; initial critique findings remain resolved.
* Review readiness: ready.
* Continuation owner: user.
