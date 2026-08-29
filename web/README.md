---
title: Certification Practice Website
description: Local setup, security policy, and deployment configuration for the React practice application
ms.date: 2026-08-29
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
- the script copies the 49-entry catalog and 14-code supported set; the UI computes the 37 requestable exams
- the React app loads that manifest and renders exam selection, practice mode, timed quizzes, and missed-question review

## Notes

- progress is stored in browser `localStorage`
- the app is built for static hosting
- GitHub Pages deployment is configured in the repository root workflow
- exam requests collect no requester email, identity, or free text
