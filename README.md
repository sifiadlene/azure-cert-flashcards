---
title: Azure and GitHub Certification Flashcards
description: Anki-compatible and browser-based practice decks for Azure and GitHub certification exams
ms.date: 2026-08-29
---

## Overview

High-quality, exam-realistic flashcards for Azure and GitHub certifications, designed for both Anki import and browser-based practice.

**🌐 [Try the live practice app](https://sifiadlene.github.io/azure-cert-flashcards/)**

## Available Flashcard Decks

All source decks live in [flashcards](flashcards):

- AI-102: Microsoft Azure AI Engineer Associate
- AI-900: Microsoft Azure AI Fundamentals
- AZ-104: Microsoft Azure Administrator
- AZ-204: Developing Solutions for Microsoft Azure
- AZ-305: Designing Microsoft Azure Infrastructure Solutions
- AZ-500: Microsoft Azure Security Technologies
- GH-300: GitHub Copilot

## Features

- Browser practice website with exam selection
- Practice mode with immediate answer reveal
- Timed quiz mode with end-of-session scoring
- Domain and topic filtering
- Missed-question review stored locally in the browser
- Requests for Microsoft Learn exams that do not yet have a deck
- Anki-compatible CSV source files for offline study

## Project Structure

- [flashcards](flashcards): source CSV decks
- [web](web): static React application for online practice
- [web/scripts/buildFlashcardData.mjs](web/scripts/buildFlashcardData.mjs): CSV-to-JSON build pipeline
- [tools/translate-decks.mjs](tools/translate-decks.mjs): Azure AI Translator script for French deck generation
- [catalog/microsoft-learn-practice-assessments.json](catalog/microsoft-learn-practice-assessments.json): versioned Microsoft Learn practice-assessment catalog
- [api](api): Azure Functions API for multiplayer challenges and exam requests
- [bicep](bicep): Azure infrastructure and operations guidance
- [.github/agents/flashcards_generator.agent.md](.github/agents/flashcards_generator.agent.md): Copilot flashcard generation agent

## Exam Catalog and Requests

The checked-in Microsoft Learn snapshot contains 49 catalog entries. The
generated supported-code artifact contains 14 local decks, including two codes
that are not in the current Learn table. The catalog-minus-supported result is
therefore 37 requestable exams.

Refresh and validate the catalog from the repository root:

```bash
node tools/refresh-exam-catalog.mjs
node --test tools/exam-catalog.test.mjs
cd web
npm run build:data
cd ..
node tools/validate-exam-data.mjs
```

The refresh is deliberate and versioned. Neither the browser nor the API
scrapes Microsoft Learn at runtime. Review and commit the canonical catalog and
its generated web and API copies together. See [tools/README.md](tools/README.md)
for deterministic offline refresh instructions.

## Running the Website Locally

Prerequisites:

- Node.js 22+
- Azure Functions Core Tools v4 for the local API
- Azurite for `AzureWebJobsStorage=UseDevelopmentStorage=true`

Steps:

```bash
cd web
npm install
npm run dev
```

The dev command automatically:

- reads the CSV decks from [flashcards](flashcards)
- selects the latest deck for each exam
- generates normalized JSON in [web/public/data](web/public/data)
- starts the Vite development server

The exam-request flow also needs a local API, Turnstile keys, and GitHub App
configuration. Copy [api/local.settings.json.example](api/local.settings.json.example)
to `api/local.settings.json`. Keep the official always-pass Turnstile secret for
local testing, generate a separate IP hashing key, and encode the GitHub App PEM:

```bash
openssl rand -base64 32
base64 -w 0 path/to/github-app.private-key.pem
```

Replace the remaining placeholders. Configure either
`EXAM_REQUEST_COSMOS_EMULATOR_CONNECTION_STRING` for a development emulator or
the Cosmos endpoint and a local Azure identity with data-plane access. Never
commit `api/local.settings.json`. Start the API in a second terminal:

```bash
cd api
npm install
npm start
```

Set `VITE_PUBLIC_API_BASE` and `VITE_TURNSTILE_SITE_KEY` before starting the
website. The complete local key setup and official Cloudflare test values are
in [web/README.md](web/README.md). Production secrets, GitHub App permissions,
rate limiting, alerts, rotation, and recovery are in
[bicep/README.md](bicep/README.md).

## Exam-request API

`POST /api/exam-requests` accepts only a normalized `examCode`, a UUID
`idempotencyKey`, and a Turnstile token. The API derives the issue title, Learn
URL, label, repository, and assignee from trusted configuration.

Outcomes are:

- `201` when GitHub confirms a new issue
- `200` with `reused: true` when an existing open issue is reused
- `400` for malformed JSON, an oversized body, or an invalid or stale exam
- `403` for a rejected, expired, or already-used Turnstile challenge
- `409` when the selected exam now has a supported deck
- `429` with `Retry-After` when the client reaches the daily limit
- `502` for a non-retryable GitHub response
- `503` with `Retry-After` for unavailable Turnstile, GitHub, Cosmos DB, or a
  pending concurrent request
- `500` for an unexpected internal failure

All responses are JSON with `Cache-Control: no-store` and a trace ID. The API
does not return GitHub response bodies or credentials. A success response is
never emitted before GitHub confirms the issue or reconciliation finds the
already-created issue. Before issue creation starts, the API records a durable,
non-expiring reconciliation state. Retries list open repository issues and scan
their bodies for the server marker, so a delayed GitHub result cannot trigger a
second create after the ordinary pending-reservation TTL.

## Building the Website

```bash
cd web
npm run build
```

This validates the source decks, generates the runtime data, and then builds the static frontend.

## Website MVP Scope

The current website supports:

- exam selection
- practice mode
- timed quiz mode
- domain and topic filters
- review of missed questions
- local browser progress persistence with `localStorage`
- bilingual interface (English / French) with a manual language toggle

Saved progress is device-local and does not sync across browsers or machines.

## Translating Flashcards to French

The website ships with an EN/FR language toggle. To generate French card content:

1. Create an [Azure AI Translator](https://portal.azure.com) resource (free tier covers all 7 decks)
2. Run the translation script from the repository root:

```bash
AZURE_TRANSLATOR_KEY=<key> AZURE_TRANSLATOR_REGION=<region> node tools/translate-decks.mjs
```

This generates `{slug}-fr.json` files in [web/public/data/decks/](web/public/data/decks/). See [tools/README.md](tools/README.md) for full instructions and cost estimates (~$6-7 one-time for S1 pricing, free on F0 tier).

## Importing Flashcards into Anki

1. Download the CSV file for your desired certification from [flashcards](flashcards)
2. Open Anki and select or create a deck
3. Import the CSV file
4. Configure import settings:
   - Type: Basic, or a custom type with an Extra field
   - Fields separated by: comma
   - Field mapping:
     - Field 1 → Front
     - Field 2 → Back
     - Field 3 → Extra
     - Field 4 → Tags
   - Enable HTML rendering for fields

### Recommended Custom Note Type

To include the Extra field on the back of the card:

1. In Anki, open Tools → Manage Note Types
2. Add a clone of Basic
3. Add an Extra field
4. Update the back template:

```html
{{FrontSide}}

<hr id=answer>

{{Back}}

{{#Extra}}
<br><br>
<div style="color: #666; font-size: 90%; border-left: 3px solid #ccc; padding-left: 10px; margin-top: 15px;">
  <strong>Additional Insight:</strong><br>
  {{Extra}}
</div>
{{/Extra}}
```

## Generating New Flashcards

This repository includes a GitHub Copilot agent at [.github/agents/flashcards_generator.agent.md](.github/agents/flashcards_generator.agent.md).

Example prompts:

```text
@flashcards_generator Generate 20 flashcards for AZ-305 focusing on networking
@flashcards_generator Create flashcards for AZ-104 identity and governance
@flashcards_generator Generate 15 advanced difficulty flashcards for AZ-204
```

The agent will:

- research exam objectives
- generate diverse question sets
- create a CSV file named `{exam}_flashcards_{YYYY-MM-DD}.csv`
- include official Microsoft references when available

## Deployment

GitHub Pages deployment is defined in [.github/workflows/deploy-site.yml](.github/workflows/deploy-site.yml).

The workflow installs frontend dependencies, runs the CSV-to-JSON generation step, builds the site with the repository base path, and publishes the static output.

## Contributing

Contributions are welcome for:

- new certification decks
- improvements to existing questions
- corrections for outdated content
- website enhancements

## License

This project is provided as-is for educational purposes.

## Disclaimer

These flashcards are study aids and should be used alongside official Microsoft certification materials. They are not affiliated with or endorsed by Microsoft Corporation or GitHub.

