# Exam date report

Official English study guides checked at **2026-11-06T03:37:24.980Z**. Covers **15 exams** with local flashcard decks.

| Exam / official study guide | Latest generation date / source CSV | Guide last updated | Published objective-effective date(s) | Notes |
| --- | --- | --- | --- | --- |
| [AB-100](https://learn.microsoft.com/en-us/credentials/certifications/resources/study-guides/ab-100) - Agentic AI Business Solutions Architect | [2026-04-02](flashcards/ab100_flashcards_2026-04-02.csv) | 2026-10-21 | 2026-11-16 (upcoming) | Upcoming objectives; current effective date may not be stated |
| [AI-102](https://learn.microsoft.com/en-us/credentials/certifications/resources/study-guides/ai-102) - Designing and Implementing a Microsoft Azure AI Solution | [2026-03-24](flashcards/ai102_flashcards_2026-03-24.csv) | 2025-12-23 | 2025-12-23 | - |
| [AI-103](https://learn.microsoft.com/en-us/credentials/certifications/resources/study-guides/ai-103) - Developing AI Apps and Agents on Azure | [2026-08-29](flashcards/ai103_flashcards_2026-08-29.csv) | 2026-10-31 | 2026-04-16 | - |
| [AI-300](https://learn.microsoft.com/en-us/credentials/certifications/resources/study-guides/ai-300) - Operationalizing Machine Learning and Generative AI Solutions | [2026-08-29](flashcards/ai300_flashcards_2026-08-29.csv) | 2026-10-15 | Not stated | Objective-effective date not stated |
| [AI-900](https://learn.microsoft.com/en-us/credentials/certifications/resources/study-guides/ai-900) - Microsoft Azure AI Fundamentals | [2026-03-24](flashcards/ai900_flashcards_2026-03-24.csv) | 2025-05-05 | 2025-05-02 | - |
| [AZ-104](https://learn.microsoft.com/en-us/credentials/certifications/resources/study-guides/az-104) - Microsoft Azure Administrator | [2026-03-24](flashcards/az104_flashcards_2026-03-24.csv) | 2026-10-30 | 2023-10-26 | - |
| [AZ-204](https://learn.microsoft.com/en-us/credentials/certifications/resources/study-guides/az-204) - Developing Solutions for Microsoft Azure | [2026-03-23](flashcards/az204_flashcards_2026-03-23.csv) | 2025-12-16 | 2026-01-14 | - |
| [AZ-305](https://learn.microsoft.com/en-us/credentials/certifications/resources/study-guides/az-305) - Designing Microsoft Azure Infrastructure Solutions | [2026-03-23](flashcards/az305_flashcards_2026-03-23.csv) | 2026-10-30 | 2026-04-17 | - |
| [AZ-400](https://learn.microsoft.com/en-us/credentials/certifications/resources/study-guides/az-400) - Designing and Implementing Microsoft DevOps Solutions | [2026-04-02](flashcards/az400_flashcards_2026-04-02.csv) | 2026-10-30 | 2026-07-27 | - |
| [AZ-500](https://learn.microsoft.com/en-us/credentials/certifications/resources/study-guides/az-500) - Microsoft Azure Security Technologies | [2026-03-24](flashcards/az500_flashcards_2026-03-24.csv) | 2025-11-23 | 2026-01-22 | - |
| [AZ-700](https://learn.microsoft.com/en-us/credentials/certifications/resources/study-guides/az-700) - Designing and Implementing Microsoft Azure Networking Solutions | [2026-04-02](flashcards/az700_flashcards_2026-04-02.csv) | 2026-06-29 | 2026-07-27 | - |
| [AZ-900](https://learn.microsoft.com/en-us/credentials/certifications/resources/study-guides/az-900) - Microsoft Azure Fundamentals | [2026-04-02](flashcards/az900_flashcards_2026-04-02.csv) | 2026-06-22 | 2026-07-20 | - |
| [DP-700](https://learn.microsoft.com/en-us/credentials/certifications/resources/study-guides/dp-700) - Implementing Data Engineering Solutions Using Microsoft Fabric | [2026-09-04](flashcards/dp700_flashcards_2026-09-04.csv) | 2026-10-30 | Not stated | Objective-effective date not stated |
| [GH-300](https://learn.microsoft.com/en-us/credentials/certifications/resources/study-guides/gh-300) - GitHub Copilot | [2026-08-28](flashcards/gh300_flashcards_2026-08-28.csv) | 2026-07-09 | 2026-08-07 | - |
| [GH-900](https://learn.microsoft.com/en-us/credentials/certifications/resources/study-guides/gh-900) - GitHub Foundations | [2026-08-29](flashcards/gh900_flashcards_2026-08-29.csv) | 2026-02-19 | 2026-01 | Exact objective day not stated |

## Date definitions

- **Latest generation date** is the date declared in the selected CSV filename, using the same latest-deck selection as the website. It is not an independently recorded generation timestamp, a file modification date, a translation date, or the JSON build time.
- **Guide last updated** is the date displayed in Microsoft Learn's "Last updated on" element. The snapshot separately preserves its timestamp and `updated_at` metadata; these can differ. `ms.date` is not used as a substitute.
- **Published objective-effective dates** come from "Skills measured as of" or "Skills at a glance as of" headings, not "prior to" sections. Multiple published dates are retained; they are not all current. Upcoming dates are relative to the snapshot retrieval date, not the day this file is read. Month-only dates preserve their precision; effectiveness within that month is uncertain. "Not stated" means no effective date was found in the recognized skills headings, not a request failure.
- A newer guide-page update does **not** by itself prove a deck is outdated or aligned with the exam. No content-alignment assessment is made by this report.

## Refresh

The versioned [study-guide snapshot](catalog/study-guide-dates.json) preserves source evidence. Report generation is offline; refreshing the snapshot deliberately accesses Microsoft Learn.

```bash
node tools/refresh-study-guide-dates.mjs
node tools/generate-exam-date-report.mjs
node tools/generate-exam-date-report.mjs --check
```

See [tools documentation](tools/README.md#exam-date-report) for validation and offline refresh instructions.
