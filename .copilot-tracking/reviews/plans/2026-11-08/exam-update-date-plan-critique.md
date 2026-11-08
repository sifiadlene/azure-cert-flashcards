# RPI Plan Critique: Exam update date

## Metadata

* Task ID: `exam-update-date`
* Critique date: 2026-11-08
* Plan: `.copilot-tracking/plans/2026-11-08/exam-update-date-plan.md`
* Critique execution: Complete
* Critique depth: standard; default
* Critique type: initial

## Inputs and Criterion Boundary

* User requested research and a plan, chose Microsoft Learn study-guide page last-updated date and the deck generation date together; no implementation.
* Evidence: `.copilot-tracking/research/2026-11-08/exam-update-date-research.md` and the repository sources referenced therein.
* Assess P01–P02, tasks P01-T01 through P02-T02, FR-001–FR-004, NFR-001–NFR-003, user decisions, dependencies, and risks.
* No open-ended research, code changes or assessment of unpublished source freshness.

## Lens Assessments

| Lens | Scope | Reasoning effort and source | Status | Candidates |
|---|---|---|---|---|
| Coverage | All requirements and tasks | host default | Complete | 3 adopted; 1 rejected: removing FR-001 from a task is traceability-only. |
| Evidence | Plan and supplied research | host default | Complete | 0 adopted; unverified candidates rejected after parent checked selector, cache, and report test sources. |
| Executability | All phases and tasks | host default | Complete | 2 adopted, including merged runner/CI and workflow-order concerns; remaining details left to implementation judgment. |
| Risk | All phases and risks | host default | Complete | 1 duplicate merged into PC-003; 2 rejected: no evidence for a new alerting policy or additional permissions. |

## Coverage Assessment

| Requirement or task | Coverage | Evidence or concern |
|---|---|---|
| FR-001–FR-004, P02-T01 | Covered | Chosen dates, both selection views, and missing/error handling specified. |
| NFR-001, P01-T01 | Partial | PC-003 through PC-005 require explicit deployment and workflow/CI wiring. |
| NFR-002–NFR-003, P02-T02 | Partial | PC-001 and PC-002 identify missing verification details. |

## Verdict

* Verdict: Revise. One High and four Medium findings need planning corrections.

## Findings

<!-- rpi:critique id=PC-001 -->
### PC-001 [Medium]: Accessibility and theme verification is underspecified

* Related IDs: P02-T02, NFR-002.
* Evidence: Plan P02-T01, P02-T02 and NFR-002.
* Concern: The browser checks omit keyboard, narrow layout and theme verification.
* Impact: The acceptance condition can fail despite the listed tests passing.
* Smallest useful change: Specify keyboard access to the link and visible labels at narrow width in both themes.
* Action owner: planning parent.
* Exact resolving evidence: P02-T02 names those checks.
* Decision route: direct planner correction.

<!-- rpi:critique id=PC-002 -->
### PC-002 [Medium]: Existing parity validation is not named

* Related IDs: P02-T02, NFR-003.
* Evidence: Plan P02-T02; web/scripts/validateFlashcardData.mjs.
* Concern: Planned validation does not explicitly execute the existing translated-deck validator.
* Impact: The stated parity invariant lacks a specific check.
* Smallest useful change: Name `npm run validate:data` as a required check.
* Action owner: planning parent.
* Exact resolving evidence: P02-T02 explicitly runs the existing validator.
* Decision route: direct planner correction.

<!-- rpi:critique id=PC-003 -->
### PC-003 [Medium]: Merge and live publication are conflated

* Related IDs: P01-T01, NFR-001.
* Evidence: Plan P01-T01 and research C3.
* Concern: The task goal can imply merging alone updates the live site.
* Impact: Readers may expect production data before deployment succeeds.
* Smallest useful change: Separate committed-copy synchronization from live deployment.
* Action owner: planning parent.
* Exact resolving evidence: P01-T01 explicitly conditions public visibility on successful deployment.
* Decision route: direct planner correction.

<!-- rpi:critique id=PC-004 -->
### PC-004 [High]: Snapshot drift checks lack explicit CI wiring

* Related IDs: P01-T01, P02-T02, NFR-001.
* Evidence: web/vitest.config.ts; web/package.json; .github/workflows/deploy-site.yml; .github/workflows/refresh-exam-date-report.yml.
* Concern: The plan requires a check but does not specify which runners execute it in deployment and refresh.
* Impact: A stale public copy could deploy undetected or tests might never run.
* Smallest useful change: Name the sync/check entry point, test runner, and CI steps.
* Action owner: planning parent.
* Exact resolving evidence: P01-T01 wires a failing check to both workflow paths and assigns tests to executed suites.
* Decision route: direct planner correction.

<!-- rpi:critique id=PC-005 -->
### PC-005 [Medium]: Snapshot synchronization order is underspecified

* Related IDs: P01-T01, NFR-001.
* Evidence: .github/workflows/refresh-exam-date-report.yml.
* Concern: The plan does not place copy synchronization before scope checks and commit staging.
* Impact: Refresh PRs may fail or omit the changed public asset.
* Smallest useful change: Specify synchronization before scope detection and staging, followed by check and tests.
* Action owner: planning parent.
* Exact resolving evidence: P01-T01 specifies the workflow ordering and exact public file.
* Decision route: direct planner correction.

## Strengths and Residual Risk

* Date definitions and user decisions are traceable to repository evidence, with deck-version and localization safeguards.
* Freshness is limited by the scheduled refresh, PR merge and deployment; no runtime staleness alert is required by the user.

## Questions or Blocking Evidence Gaps

None requiring user input.

## Limitations

* Static assessment only; no implementation or live deployment was tested.
* Evidence lens returned partial; parent verified the bounded selector, challenge cache and report-test evidence directly.

## Recommended Next Action

* Highest-impact finding: PC-004.
* Action owner: planning parent.
* Smallest next action: specify workflow, command and runner wiring and resolve remaining findings.
* User response required: no.
