---
title: Certification Practice Website
description: Local setup, security policy, and deployment configuration for the React practice application
ms.date: 2026-11-11
ms.topic: how-to
---

This app provides browser-based practice for the certification decks stored in the repository root.

## Commands

```bash
npm install
npm run dev
npm run build
```

## Local Exam-request Setup

Start the Azure Functions API as described in the root README, then configure
the Vite process:

```bash
VITE_PUBLIC_API_BASE=http://localhost:7071/api \
VITE_TURNSTILE_SITE_KEY=1x00000000000000000000AA \
npm run dev
```

Cloudflare provides these [official visible test sitekeys](https://developers.cloudflare.com/turnstile/troubleshooting/testing/):

- `1x00000000000000000000AA` always passes
- `2x00000000000000000000AB` always blocks
- `3x00000000000000000000FF` forces an interactive challenge

The official matching server test secrets are:

- `1x0000000000000000000000000000000AA` always passes validation
- `2x0000000000000000000000000000000AA` always fails validation
- `3x0000000000000000000000000000000AA` returns a token-already-spent error

Test sitekeys work on any hostname. A dummy sitekey must be paired with a dummy
secret; a production secret rejects dummy tokens. Set
`EXAM_REQUEST_TURNSTILE_HOSTNAMES=localhost,127.0.0.1` and the matching test
secret in the local API settings. The browser always sends the Turnstile action
`exam-request`, which the API verifies.

The Playwright configuration supplies the always-pass and always-block sitekeys
and mocks the external widget and API behavior. Standard CI does not contact
Cloudflare or GitHub.

## Production Web Configuration

Set these GitHub Actions variables before running the Pages workflow:

- `VITE_PUBLIC_API_BASE` to the deployed Bicep `functionApiBaseUrl` output
- `VITE_TURNSTILE_SITE_KEY` to the public production widget sitekey

Register the exact production hostname in the Cloudflare Turnstile widget. Do
not add the Turnstile secret, GitHub private key, or IP hashing key to Vite
variables. Every `VITE_*` value is public and can be included in the browser
bundle.

If the hosting layer sends a Content Security Policy, allow the widget origin
without weakening unrelated directives. The minimum additions are:

```text
script-src 'self' https://challenges.cloudflare.com;
frame-src https://challenges.cloudflare.com;
connect-src 'self' https://challenges.cloudflare.com <function-api-origin>;
```

Preserve any existing sources required by the site. The script is loaded from
`https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit`; blocking
its script, frame, or network requests makes exam submission unavailable.

## How It Works

- [scripts/buildFlashcardData.mjs](scripts/buildFlashcardData.mjs) reads the CSV decks from [../flashcards](../flashcards)
- the script selects the latest file for each exam and writes normalized JSON into [public/data](public/data)
- the script copies the catalog and supported-code set; the UI computes requestable exams as the catalog minus supported decks
- the React app loads that manifest and renders exam selection, practice mode, timed quizzes, and missed-question review
- after an exam is selected, solo and challenge setup show the deck generation date from the selected CSV filename and the last-updated date of its Microsoft Learn study-guide page
- the guide date is not an exam-objective change date and does not establish that the flashcards are aligned or outdated; missing or failed guide data does not prevent practice
- the checked-in [study-guide snapshot](../catalog/study-guide-dates.json) is copied to [public/data/study-guide-dates.json](public/data/study-guide-dates.json) with `node tools/sync-study-guide-public.mjs` from the repository root; `--check` verifies the copy without changing it
- review status appears only when a record in [study-guide-reviews.json](../catalog/study-guide-reviews.json) matches both the current guide-page revision and deck version; add a record only after documenting a complete objective-to-card review, and update its public copy alongside the canonical file
- the displayed alignment date is the actual review date, not the guide update date; a changed guide revision or deck version hides the old alignment status
- a review with unresolved coverage gaps is labelled as such and is not presented as aligned; a changed guide revision or deck version hides the old review status
- the guide-date sync check also verifies that the review catalog and public copy match; the weekly refresh opens a pull request for guide-date snapshots, and updates reach the live site only after merge and successful deployment

## Notes

- progress is stored in browser `localStorage`
- the app is built for static hosting
- GitHub Pages deployment is configured in the repository root workflow
- exam requests collect no requester email, identity, or free text
