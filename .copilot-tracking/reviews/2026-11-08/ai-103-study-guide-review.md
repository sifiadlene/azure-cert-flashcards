# AI-103 study-guide review

## Result

Reviewed on **2026-11-08** against the official English AI-103 guide revision
dated **2026-10-31** and deck version **2026-08-29**
(`flashcards/ai103_flashcards_2026-08-29.csv`, 100 cards). The guide's current
skills are effective **2026-04-16**. The revision is current, not upcoming.
The objectives did not change between the predecessor and the October 31
revision, so no cards were added, corrected, or removed for this update.

The deck's 100-card domain split (28 / 33 / 13 / 13 / 13) falls within the
guide's respective published ranges (25–30 / 30–35 / 10–15 / 10–15 / 10–15).
This proportion check and the broad objective-to-card crosswalk below do not
establish complete coverage: the specific gaps listed below remain. The app
therefore labels this as a completed review with coverage gaps, not verified
alignment. No regeneration was performed based solely on a page-date change.

## Revision evidence

The live [English AI-103 study guide](https://learn.microsoft.com/en-us/credentials/certifications/resources/study-guides/ai-103)
displays `Last updated on 2026-10-31` (`2026-10-31T01:16:00Z`). Its independent
`updated_at` metadata is `2026-11-05T22:08:00Z`; neither that later metadata
timestamp nor `ms.date` (`2026-03-31`) was substituted for the displayed date.
The canonical and public study-guide snapshots both already contain the
displayed date `2026-10-31`; no date change was required.

The predecessor banner reads `2026-04-14` in two captures of the same official
page:

- [Internet Archive capture from 2026-06-06](http://web.archive.org/web/20260606144029/https://learn.microsoft.com/en-us/credentials/certifications/resources/study-guides/ai-103)
- [Internet Archive capture from 2026-10-02](http://web.archive.org/web/20261002002515/https://learn.microsoft.com/en-us/credentials/certifications/resources/study-guides/ai-103)

A raw-HTML article-body comparison between the October 2 capture and the live
page found three net edits: removal of a certification-earning table row, an
AI Skills Navigator Practice Assessment tip, and an Exam Prep video link.
The entire `Skills measured as of April 16, 2026` section, including all
domain weights and skill bullets, was byte-identical. No second or future
objectives section was present. Microsoft does not publish an official
historical diff for this page; the archived capture is the available
predecessor evidence. No Wayback capture covers October 2 through the live
retrieval, so the exact publication day and any intermediate page edits in
that interval remain unknown. The comparison establishes no objective change
between the two observed states, not a Microsoft attestation that nothing
changed during the entire interval.

## Objective-to-card crosswalk

Card numbers refer to row order in the versioned CSV above. Skill names below
follow the current guide; card references show representative direct coverage,
not proof that every listed nuance is fully tested.

| Official skill area | Card evidence |
| --- | --- |
| Choose Foundry models, services, retrieval/indexing, and agent memory/tool/knowledge integrations | 1–8, 29–31, 38–40, 60–61 |
| Set up AI solutions: infrastructure, deployment, model/agent setup, CI/CD | 8–12; infrastructure architecture is not explicit |
| Manage quotas, scaling, rate limits, and cost | 13–14, 25 |
| Monitor model performance, drift, safety events, and grounding quality | 15, 21, 26, 28, 34–36; drift and safety-event monitoring are not explicit |
| Monitor ingestion quality, search health, and relevance | 15–16, 31, 56, 88–95 |
| Configure identity, private networking, keyless credentials, and role policies | 17–18; role-policy/RBAC coverage is not explicit |
| Configure safety filters/guardrails/moderation; apply evaluators, safety evaluations, and explanation tooling | 19–21, 34–36; explanation tooling is not explicit |
| Audit traces/provenance/approvals; govern oversight, constraints, and tool access | 22–24, 27, 38, 41, 44 |
| Build generative apps: model consumption, RAG, workflows, evaluation, SDKs/connectors, project configuration | 1–2, 29–37, 47–49, 56, 59–61 |
| Build agents: roles/goals/conversation/tool schemas, retrieval/function/memory tools, APIs/knowledge/search, multi-agent handoffs, safeguards, monitoring/error analysis | 38–46, 57–58, 95 |
| Optimize generative systems: prompts/parameters, reflection/self-critique, tracing/token analytics/latency, multi-model and hybrid orchestration | 47–55 |
| Generate images/videos, edit images/videos, and apply generation/editing controls | 62–65; reference-media and platform-control breadth is limited |
| Multimodal visual context, captions, visual Q&A, accessibility descriptions, Content Understanding, video, and object localization | 66–73; multiple-image captioning is not explicit |
| Responsible AI for visual content: unsafe-content filters, embedded-text injection, visual policy enforcement | 74 covers embedded-text prompt injection only; unsafe-content filtering and visual policy rules are not covered |
| Text extraction/topics/summaries/structured output, sentiment/sensitive-content/safety, translation, and domain customization | 75–80, 86–87 |
| Speech-to-text/text-to-speech, custom speech, audio reasoning, and speech translation | 81–85 |
| Retrieval pipelines: multimodal ingestion, hybrid/semantic search, enrichment, OCR, RAG flow, and agent/workflow connections | 88–95 |
| Document extraction: OCR/layout/fields, Content Understanding representations, and structured/Markdown analyzer output | 96–100 |

## Remaining coverage gaps

- The guide's multimodal responsible-AI objectives for classifying unsafe or
  disallowed visual content and enforcing visual policies (for example
  watermarking, prohibited-symbol/brand checks, and inappropriate-content
  detection) have no direct card. Card 74 addresses only prompt injection
  carried in image text.
- Image editing is represented by a mask-based inpainting/background-replacement
  scenario (card 63), but platform-specific controls are not explicit. Image
  generation does not explicitly test reference-media conditioning, and
  captioning does not test multiple-image input.
- Plan/manage coverage does not explicitly test AI infrastructure architecture,
  role-policy/RBAC configuration, model drift or safety-event monitoring, or
  explanation tooling.

These are coverage observations against the current guide, not changes
introduced on October 31. They remain open; the deck is not labeled aligned.

## Sources and validation

- Official guide and current skill text:
  https://learn.microsoft.com/en-us/credentials/certifications/resources/study-guides/ai-103
- Archived predecessor page states: the two Internet Archive captures above.
- Versioned deck: `flashcards/ai103_flashcards_2026-08-29.csv`.
- Official date evidence: `catalog/study-guide-dates.json` and
  `web/public/data/study-guide-dates.json`, AI-103 entry.
- Review date is the actual review date, **2026-11-08**. The app record is
  current only while its guide URL/revision and deck version match those
  current sources exactly.
