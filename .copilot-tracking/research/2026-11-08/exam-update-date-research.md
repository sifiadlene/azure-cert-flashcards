# Research: Exam update date

## Executive Summary

The app does not currently display an exam date. It has a deck date in its data and the repository separately records official study-guide page updates and objective-effective dates. The user selected the study-guide page update date.

### What You May Not Know

The official page update is not proof that the exam objectives changed or that a deck is outdated. The weekly snapshot is refreshed through a pull request, and the website's production workflow builds from checked-in data rather than regenerating its manifest.

## Findings

* **C1 — Existing date:** [web/scripts/buildFlashcardData.mjs](../../../web/scripts/buildFlashcardData.mjs) sets `updatedOn` and `deckVersion` to the selected CSV filename date. [web/src/App.tsx](../../../web/src/App.tsx) shows an exam selector but no deck date; [web/src/challenge/ChallengeViews.tsx](../../../web/src/challenge/ChallengeViews.tsx) has a second selector. Confidence: high; inspected generator, types and both views.
* **C2 — Official evidence:** [catalog/study-guide-dates.json](../../../catalog/study-guide-dates.json) stores `pageUpdatedOn`, `guideUrl`, `retrievedAt`, and zero or more objective dates for each exam. [EXAM-DATE-REPORT.md](../../../EXAM-DATE-REPORT.md) distinguishes page update, deck generation, and effective dates. For AB-100 the three dates differ: 2026-10-21, 2026-04-02, and 2026-11-16 respectively. Confidence: high; snapshot and report agree.
* **C3 — Data refresh and deployment:** [.github/workflows/refresh-exam-date-report.yml](../../../.github/workflows/refresh-exam-date-report.yml) creates a weekly PR limited to the snapshot and report. [.github/workflows/deploy-site.yml](../../../.github/workflows/deploy-site.yml) builds from committed `web/public/data` without running the generator, after successful API workflow completion or manual dispatch. Therefore a generated public copy or manifest must be refreshed in the PR and checked against the snapshot, or the site build must derive it without changing unrelated generated data. Refresh PRs must be merged and deployment succeed before the new data is public. Confidence: high; inspected workflows.
* **C4 — Language and time:** [web/src/i18n/locales/en.json](../../../web/src/i18n/locales/en.json) and [web/src/i18n/locales/fr.json](../../../web/src/i18n/locales/fr.json) provide UI translations. The existing `formatDate` in `App.tsx` formats timestamps using local timezone; date-only values require date-only handling to avoid a previous-day shift. Confidence: high.
* **C5 — Existing contracts:** [tools/exam-date-report.mjs](../../../tools/exam-date-report.mjs) validates the snapshot and expects manifest `updatedOn` to remain the CSV date; [web/scripts/validateFlashcardData.mjs](../../../web/scripts/validateFlashcardData.mjs) checks English/French deck parity. Do not repurpose the existing date or accidentally require translated decks to be regenerated on every guide refresh. Confidence: high.

## Recommendation and Alternatives

Recommend displaying the existing deck generation date alongside the Microsoft Learn **study-guide page last updated** date, clearly labelled and linked to its guide, if this is the user's intent. It uses existing evidence without implying exam content changed. An objective-effective date is a different alternative: it can be absent, month-only, future, or multiple, and needs explicit semantics. Showing only the deck date would not add an official update indicator.

## Scope and Questions

Research and plan adding an update date near the exam date in the web app. Questions: which date and display location are intended; where data originates; how refresh reaches production; and what must be verified. No production implementation is included.

## Decisions and Feedback

Decision participation: user-owned. The user selected the Microsoft Learn study-guide page's last-updated date and chose to show it alongside the deck generation date.

## Risks and Open Questions

* A page's update date is not an authoritative objective-change date; labels must not imply equivalence.
* Snapshot freshness depends on a successful refresh, PR merge and deployment.

## Planning Readiness and Next Step

Research completed for the observed repository. The chosen date and accompanying deck date support implementation planning.

## Research Record

* Date: 2026-11-08, supplied by session clock; root: repository workspace.
* Mode: convergence for an implementation plan; posture: balanced, default; helpers: none.
* Wider: examined exam date report, catalog, manifest, generator, UI, and both refresh and deployment workflows.
* Deeper: traced CSV date and guide metadata through validators, localization and deployment.
* Contrarian: examined objective-effective dates and deck version parity as alternative interpretations and hazards; reviewed the challenge selector for a second surface.
* Synthesis: retain C1–C5; user selected the guide page update date and deck generation date together; reject conflating guide page updates with changes to actual exam objectives.
* Re-entry: no further repository research required for the selected date semantics; no external date freshness claim made.
