<!-- markdownlint-disable-file -->
# Review: Exam update date

## Executive Summary

* Assessment: The full implementation is consistent with the accepted plan and confirmed date semantics; no substantive findings were identified.
* Why this matters: The work exposes official study-guide page dates and existing deck generation dates in the solo and challenge setup flows.
* Review execution: Complete.
* Assessed outcome: Conformant.
* Validation coverage: Reported offline, unit, browser, parity, lint, and deploy-equivalent build checks cover the plan's required verification; no checks were rerun as part of this review.
* Confidence and limitations: High for the checked-in implementation; live deployment and future snapshot freshness were not assessed.

The assessment above is the reviewer's proposal. Parent Decision Record contains the final decisions and next actions, or states that decisions are pending.

## What You May Not Know

The guide page's last-updated date does not establish that exam objectives changed or that the flashcard deck is aligned. Snapshot changes reach the live site only after merge and successful deployment.

## Findings and Proposed Routes

No substantive findings were identified within the assessed boundary.

## Parent Decision Record

<!-- Decisions live here. Append events; never rewrite the evidence body above to fit a decision. -->

### Current Disposition

* Based on events: RD-001, RD-002, RD-003, RD-004, RD-005.
* Review execution: Complete.
* Final outcome: Conformant; no material contract gaps were identified.
* Finding decisions and next actions: none.
* Decisions still needed: none; user-owned walkthrough completed with no actionable findings.

This summary is derived from Decision History, not a second decision record. The latest event for each subject governs; refresh this summary after appending decisions and on recovery.

### Decision History

Append events in order. Never rewrite or delete an earlier row. The latest event for a subject is current.

| Event | Subject | Decision source | Status or value | Proposed destination | Final destination | Owner | More information needed | Smallest next action | Rationale |
|---|---|---|---|---|---|---|---|---|---|
| RD-001 | decision-participation | user | user-owned; standalone manual RPI review | none | none | user | none | Compare full plan scope | Standalone/manual review uses user-owned decisions. |
| RD-002 | review-execution | reviewer | Complete | none | none | reviewer | none | Close review | All in-scope plan markers and material contracts were compared against implementation and recorded validation evidence. |
| RD-003 | final-outcome | reviewer | Conformant | none | none | user | none | No handoff required | No substantive findings remain; reported validation covers the accepted requirements and the known deployment limit is documented. |
| RD-004 | review-item-walkthrough | reviewer | completed; no actionable findings | none | none | user | none | No per-item question required | User-owned participation applies, but the comparison found no actionable `RV-xxx` items to walk through. |
| RD-005 | continuation | reviewer | no handoff | none | none | user | none | No follow-up required | No accepted findings or residual work require another RPI stage. |

## Validation Evidence

| Command | Scope | Status | Summary |
|---|---|---|---|
| `node --test --test-reporter=dot tools/exam-date-report.test.mjs` | P01-T01 | Passed (reported) | Changes record reports 19 offline tests passed. |
| `node tools/sync-study-guide-public.mjs --check` | P01-T01 | Passed (reported) | Changes record reports the checked-in public snapshot matches the canonical file. |
| `npx vitest run src/studyGuideDates.test.ts` | P02-T02 | Passed (reported) | Four focused date tests passed. |
| `npx playwright test exam-dates.spec.ts` with session-only config | P02-T02 | Passed (reported) | Eight date browser tests passed; the standard Windows startup is Unix-oriented. |
| Playwright solo/challenge regression tests | P02-T02 | Passed (reported) | Nine existing tests passed in the equivalent session-only harness. |
| `npm run validate:data` | P02-T02 | Passed (reported) | Changes record reports deck parity validation passed. |
| `npm run lint`, `npx tsc -b`, `npx vite build` | P02-T02 | Passed (reported) | Changes record reports lint and deploy-equivalent build passed. |
| `git diff --check` and public snapshot check | Review | Passed (reported) | The implementation handoff reports both checks passed; this review did not rerun them. |

## Risks, Blockers, and Residual Work

* Blockers: None identified.
* Remaining active work: None reported by the implementation record.
* Residual work: None reported by the plan or implementation record.

## Review Record

### Scope and Evidence

* Task ID: `exam-update-date`
* Review date: 2026-11-08
* Review scope: Full task.
* Assessed boundary: P01/P01-T01 and P02/P02-T01/P02-T02; FR-001–FR-004, NFR-001–NFR-003; implementation-time plan updates; confirmed user date semantics; validation, blockers, remaining work, and follow-ups.
* Review depth and provenance: standard; default.
* Candidate identity: `exam-update-date`, full plan, workspace working-tree implementation.
* Review execution: Complete.
* Helper use: none.
* Plan: .copilot-tracking/plans/2026-11-08/exam-update-date-plan.md
* Plan critique: .copilot-tracking/reviews/plans/2026-11-08/exam-update-date-plan-critique.md
* Changes: .copilot-tracking/changes/2026-11-08/exam-update-date-changes.md
* Other evidence considered: .copilot-tracking/research/2026-11-08/exam-update-date-research.md; implementation diff and untracked source/test files.

### Opening Review State

* Interpreted review goal: Compare the completed implementation against the approved plan, confirmed date semantics, critique dispositions, and reported validation; determine evidence-based outcome and any routes.
* Review scope: Full task.
* Evidence readiness: Plan markers are checked, changes record reports complete/review-ready, critique and research are available, and implementation evidence is present in the workspace.
* Acceptance basis: FR-001–FR-004, NFR-001–NFR-003, P01-T01 and P02-T01/P02-T02 details, user decisions D1/D2, resolved critique findings, and changes-record validation.
* First comparison boundary: Compare each plan marker and requirement with source, workflow, documentation, and test evidence; assess cited checks as reported, not rerun by review. No live deployment is in scope.
* Active read-only boundaries: Review may write only this canonical review record; do not modify implementation or other tracking artifacts.
* Authority: the review parent compares evidence and writes findings; final outcome, route dispositions, and continuation are recorded in Parent Decision Record
* Initial blockers: none.

### Acceptance and Change Coverage

| Requirement or scope | Implementation and validation evidence | Assessment | Finding or rationale |
|---|---|---|---|
| P01 / P01-T01; FR-002, NFR-001, NFR-003 | `tools/sync-study-guide-public.mjs` validates the canonical snapshot and checks byte equality with `web/public/data/study-guide-dates.json`; the weekly refresh syncs before scope verification and stages the public file; API and Pages workflows check it. `tools/exam-date-report.test.mjs` covers missing, mismatch, malformed inputs and workflow order. Changes record reports 19 offline tests and the snapshot check passed. | Met | The checked-in public asset is generated from the canonical snapshot; refresh and deployment paths guard against drift without repurposing deck metadata. |
| P02-T01; FR-001, FR-002 | `web/src/App.tsx` and `web/src/challenge/ChallengeViews.tsx` pass the selected manifest exam into shared `web/src/ExamDates.tsx`. It labels `updatedOn` as deck generation and displays the code-matched `pageUpdatedOn` with a canonical Microsoft Learn link. English/French labels and `web/README.md` document semantics. | Met | The user-confirmed date semantics are preserved; the UI does not equate guide updates with changed objectives or deck alignment. |
| P02-T01; FR-003 | Both setup views render dates only when an exam is selected; challenge selection resolves by `examSlug`, and solo selection uses the selected exam summary. `web/tests/e2e/exam-dates.spec.ts` covers two dates, changing selections and no dates before selection. | Met | Both independent exam-selection surfaces follow the same component contract. |
| P02-T01; FR-004 | `web/src/studyGuideDates.ts` validates schema, date, code and exact guide URL; `web/src/ExamDates.tsx` exposes localized loading, unavailable and error states. The E2E suite covers missing entries, empty/invalid snapshot and HTTP failure while confirming solo/challenge setup remains usable. | Met | Empty snapshots are rejected, while a valid snapshot missing one selected exam remains an unavailable state. |
| P02-T02; NFR-002 | `web/src/studyGuideDates.ts` formats date-only values with UTC. The unit/E2E suites cover English/French, a negative UTC offset, keyboard navigation, 320px layout and light/dark themes. Changes record reports four unit and eight date browser tests passed. | Met | The reported coverage matches the specified date and access conditions. |
| P02-T02; NFR-003 | `tools/exam-date-report.test.mjs` checks deck data/workflow contracts; `web/tests/e2e/exam-dates.spec.ts` and existing `gh300.spec.ts`/`challenge.spec.ts` cover practice and challenge behavior. Changes record reports nine existing solo/challenge browser tests passed, `npm run validate:data`, lint, TypeScript build and Vite build passed. | Met | No deck version or translated-deck metadata was changed; the targeted regression and build checks are reported passed. |
| User decisions D1/D2; goals and non-goals | Plan decisions define the guide page date alongside the CSV-derived deck date; implementation labels and docs preserve that distinction and avoid objective-alignment claims. | Met | Confirmed user intent remains intact. |
| Implementation-time updates: shared test guidance, Windows browser setup, empty-snapshot consistency | Plan `Guidance` points to the shared component/loader and Windows test workaround; changes record describes the workaround and final empty-snapshot correction. Empty snapshot validation is consistent in publisher and runtime loader; browser fixtures distinguish an absent exam from an invalid empty snapshot. | Met | Evidence-backed clarifications; no unresolved plan change or premature dependent work. |

### Critique and Follow-Up Assessment

* Latest critique dispositions: PC-001 through PC-005 are marked resolved in the plan; implementation and the changes record include corresponding keyboard/mobile/theme, parity validation, merge/deployment distinction, workflow checks, and sync ordering.
* Material revisions: Shared-component test guidance and the Windows-equivalent browser harness are documented; empty-snapshot rejection enforces the plan's invalid-data requirement and is covered in unit/E2E tests.
* Dependent-work pause assessment: P02-T02 followed P02-T01; no dependent work resumed ahead of its dependency.
* Justification assessment: The Windows startup workaround retained the same Chromium tests and API/proxy contract; it changes validation mechanics only and is a justified platform-specific limitation.

| Follow-up item | Why outside immediate scope | Owner or next action | Assessment and route |
|---|---|---|---|
| None | N/A | N/A | The plan and changes record report no distinct follow-up work. |

### Reviewer Self-Check

* [x] Every supplied requirement, acceptance criterion, in-scope marker, material update, critique disposition, validation result, blocker, remaining item, and plan follow-up has an assessment or explicit gap.
* [x] Findings are substantive, evidence-grounded, severity-graded, and use stable `RV-xxx` IDs with expected and observed behavior, a resolution condition, and one proposed route each.
* [x] Execution status, assessed outcome, validation coverage, limitations, and proposed routes are complete and internally consistent.
* [x] The summary is scoped and advisory, findings keep their supporting context together, and acceptance coverage distinguishes demonstrated gaps from unassessed behavior.
* [x] Standard review completely assessed the material boundary while omitting restatement, cosmetic feedback, exhaustive strengths, low-impact suggestions, and continual narration; deep review remained inside the supplied boundary.
* [x] The review did not mutate source, the plan, critique, research, or changes record, wrote only this record (including a Stakeholder Note Draft only for an accepted drafting action), did not execute validation, verified any helper candidate at its cited evidence before recording it as a finding, and counted a requirement consistent only from a cited location.
* Checked boundary: full plan requirements, markers, implementation updates, critique dispositions, validation evidence, follow-ups, and gaps.
* Missing or limited evidence: no live deployment was requested or assessed.
