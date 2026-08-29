---
title: Challenge API Azure deployment
description: Configuration, security, deployment, and recovery requirements for the challenge and exam-request Azure resources.
ms.date: 2026-08-29
ms.topic: how-to
---

## Resource footprint

The resource-group deployment creates only the challenge API dependencies:

* One Linux Azure Functions Flex Consumption FC1 plan and Node.js 22 Function App
* One StorageV2 account for Functions host state and Flex deployment packages
* One serverless Azure Cosmos DB for NoSQL account, database, challenge containers, and an exam-requests container
* One Log Analytics workspace and workspace-based Application Insights component
* Storage control-plane role assignments required by the Functions host
* A database-scoped custom Cosmos DB data-plane role and assignment for the Function system-assigned identity

The rooms container uses `/roomId`. The room-code lookup container uses `/roomCode`. Both enable TTL with the configured retention period, which defaults to 86,400 seconds. The same value is supplied to the Function App as `CHALLENGE_RETENTION_SECONDS`, so application expiry checks and every room, mapping, receipt, and answer marker use one validated retention period.

The exam-requests container uses `/id` and has `defaultTtl = -1`. Ephemeral
rate-limit, claim, and pending records set a per-item TTL. Durable per-exam issue
mappings omit `ttl`, so they do not expire.

## GitHub environment configuration

Create a protected GitHub environment named `production`. Configure these environment or repository variables:

* `AZURE_CLIENT_ID`: Client ID of the Microsoft Entra application or user-assigned identity used for GitHub OIDC
* `AZURE_TENANT_ID`: Microsoft Entra tenant ID
* `AZURE_SUBSCRIPTION_ID`: Target Azure subscription ID
* `AZURE_RESOURCE_GROUP`: Existing target resource group
* `AZURE_LOCATION`: Azure region supporting Flex Consumption and serverless Cosmos DB
* `AZURE_ALLOWED_ORIGINS_JSON`: JSON array of exact HTTPS origins, such as `["https://example.github.io"]`
* `AZURE_ALERT_ACTION_GROUP_RESOURCE_IDS_JSON`: Non-empty JSON array of complete Azure Monitor action group resource IDs
* `VITE_PUBLIC_API_BASE`: Deployed `functionApiBaseUrl` output used by the Pages workflow
* `EXAM_REQUEST_GITHUB_APP_ID`: Numeric GitHub App ID
* `EXAM_REQUEST_GITHUB_INSTALLATION_ID`: Numeric installation ID
* `EXAM_REQUEST_GITHUB_OWNER`: `sifiadlene`
* `EXAM_REQUEST_GITHUB_REPOSITORY`: `azure-cert-flashcards`
* `EXAM_REQUEST_GITHUB_ASSIGNEE`: `sifiadlene`
* `EXAM_REQUEST_TURNSTILE_HOSTNAMES_JSON`: JSON array of exact production hostnames without schemes or paths
* `VITE_TURNSTILE_SITE_KEY`: Public production Turnstile sitekey used by the Pages workflow

Configure these GitHub environment secrets:

* `CHALLENGE_TOKEN_PEPPER`: Base64 encoding of at least 32 random bytes
* `EXAM_REQUEST_IP_HASH_KEY`: Base64 encoding of a separate value containing at least 32 random bytes
* `EXAM_REQUEST_TURNSTILE_SECRET`: Production Turnstile widget secret
* `EXAM_REQUEST_GITHUB_PRIVATE_KEY_BASE64`: Base64 encoding of the complete GitHub App PEM private key

Encode the PEM without introducing line-wrap ambiguity:

```bash
base64 -w 0 path/to/github-app.private-key.pem
```

On systems without GNU `base64`, use an equivalent command that emits one
continuous Base64 value. Decode the result in a temporary location and compare
it with the PEM before storing the secret. The deployment workflow validates
the random-key length and verifies that the decoded App key contains a PEM
private-key header. Generated deployment parameter JSON is written under the
runner temporary directory and removed even when deployment fails.

The example parameter files contain non-secret injection markers because Bicep
requires assignments for mandatory parameters. Never commit real values,
generated parameter JSON, decoded private keys, or secrets as Bicep outputs.

## GitHub App Setup

Create a GitHub App owned by the account that manages the target repository.
Disable unneeded webhooks and grant only these repository permissions:

* Metadata: Read-only
* Issues: Read and write

Install the App for **Only select repositories** and select
`sifiadlene/azure-cert-flashcards`. Record the App ID and installation ID, then
generate a private key and store only its Base64 representation in the protected
GitHub environment. The API requests installation tokens restricted to that
repository and Issues write permission.

Create the `exam-request` label in the target repository before enabling the
feature. Confirm that `sifiadlene` can be assigned to issues in the repository.
The API creates issues with this label and assigns `@sifiadlene`.

> [!IMPORTANT]
> Email is provided by GitHub's issue-assignment notification. Enable email as
> a delivery destination in `@sifiadlene`'s GitHub notification settings and
> ensure assigned issue notifications are not filtered or muted. Reused open
> issues do not create a new assignment and therefore do not guarantee another
> email. There is no separate email service.

For temporary local troubleshooting, a fine-grained PAT may be used only with
repository-scoped Issues read/write access. The deployed adapter uses GitHub
App authentication, so a PAT must not be placed in the production App-key
setting.

## Turnstile Production Setup

Create a production Turnstile widget, register the exact GitHub Pages hostname,
and store its public sitekey in `VITE_TURNSTILE_SITE_KEY`. Store the secret in
`EXAM_REQUEST_TURNSTILE_SECRET` only. Set
`EXAM_REQUEST_TURNSTILE_HOSTNAMES_JSON` to the same hostname allowlist. Do not
include `localhost` or `127.0.0.1` in the production widget.

For local or automated testing, use Cloudflare's official test pairs documented
in [web/README.md](../web/README.md). Production and test keys cannot be mixed.
The API verifies the hostname, the `exam-request` action, token validity, and
the request UUID as Cloudflare's idempotency key.

The deployed site must permit `https://challenges.cloudflare.com` in its
Content Security Policy for scripts, frames, and connections. The web guide
contains the required directives.

## Function Settings

Bicep configures these exam-request settings:

* `EXAM_REQUEST_COSMOS_ENDPOINT`, `EXAM_REQUEST_COSMOS_DATABASE`, and `EXAM_REQUEST_COSMOS_CONTAINER`
* `EXAM_REQUEST_CATALOG_PATH` and `EXAM_REQUEST_SUPPORTED_CODES_PATH`
* `EXAM_REQUEST_RATE_LIMIT`, defaulting to 3
* `EXAM_REQUEST_PENDING_TTL_SECONDS`, defaulting to 120
* `EXAM_REQUEST_PENDING_WAIT_MS`, defaulting to 4000
* `EXAM_REQUEST_UPSTREAM_TIMEOUT_MS`, defaulting to 5000
* `EXAM_REQUEST_IP_HASH_KEY`
* `EXAM_REQUEST_TURNSTILE_SECRET` and `EXAM_REQUEST_TURNSTILE_HOSTNAMES`
* `EXAM_REQUEST_GITHUB_APP_ID`, `EXAM_REQUEST_GITHUB_INSTALLATION_ID`, and `EXAM_REQUEST_GITHUB_PRIVATE_KEY_BASE64`
* `EXAM_REQUEST_GITHUB_OWNER`, `EXAM_REQUEST_GITHUB_REPOSITORY`, and `EXAM_REQUEST_GITHUB_ASSIGNEE`

`EXAM_REQUEST_COSMOS_EMULATOR_CONNECTION_STRING` exists only in local settings
and is rejected outside development or test mode. The deployed Function uses
managed identity for Cosmos DB.

The package includes the 49-entry canonical catalog and the generated
supported-code artifact. The current overlap produces 37 requestable exams.

## Trusted Proxy and Rate Policy

Azure's front end is expected to append the connected client hop to
`X-Forwarded-For`. The API trusts only the rightmost syntactically valid IP
address and never searches attacker-controlled earlier values. Confirm this
behavior in the development Function App before production rollout by comparing
the platform header shape with a known client request. If the rightmost hop is
missing or malformed, IP rate limiting is skipped and mandatory Turnstile
verification remains in force.

Client addresses are HMAC-SHA256 hashed with `EXAM_REQUEST_IP_HASH_KEY`. Raw
addresses are not persisted or emitted to telemetry. The initial policy accepts
at most three first-time issue creations per hash in each UTC-day bucket. Open
issue reuse does not consume another claim. A limit response is `429` and its
`Retry-After` value points to the next UTC boundary.

Treat this limit as a best-effort layer behind Turnstile. Do not raise it before
reviewing abuse telemetry and Cosmos concurrency behavior.

The OIDC principal needs resource deployment access in the target resource group, permission to create Azure role assignments on the Functions storage account, and permission to create Cosmos DB SQL role definitions and assignments. Scope these permissions to the target resource group where possible.

## Alerts and Action Groups

The deployment creates Application Insights scheduled-query alerts for:

* More than five rate-limited events in 15 minutes
* More than five Turnstile rejections or failures in 15 minutes
* At least two GitHub failures in 15 minutes
* More than 50 exam-request telemetry events in 15 minutes
* At least one stale pending reservation in 15 minutes

Set `AZURE_ALERT_ACTION_GROUP_RESOURCE_IDS_JSON` in the protected production
GitHub environment to a non-empty JSON array of complete Azure Monitor action
group resource IDs. The workflow validates each ID and injects the array into
the `alertActionGroupResourceIds` Bicep parameter. Production deployment fails
closed when the variable is absent, empty, malformed, or contains a resource
other than `Microsoft.Insights/actionGroups`. Development deployments may keep
the parameter empty. Add email, SMS, webhook, or incident tooling to the action
group according to the production escalation policy, and test the action group
before rollout.

## Deployment behavior

Pull requests and branch pushes run API tests, web tests, the full Playwright suite, checked-in data validation, application builds, package assembly, and Bicep compilation. Pull requests never deploy.

A push to `main` or a manual workflow dispatch runs the same validation before signing in through GitHub OIDC. It then validates and previews Bicep, deploys the resource-group template, and publishes only the API package. The package contains compiled JavaScript, production dependencies, `host.json`, and copied canonical English deck artifacts.

The target resource group must exist before the workflow runs. Resource-group creation and Azure deployment are intentionally not performed during local validation.

`alwaysReadyInstanceCount` remains zero. The low-frequency endpoint can scale to
zero; add an always-ready instance only after measured latency justifies the
cost.

## Secret Rotation

Rotate secrets without committing them:

1. Generate and save the replacement secret in the protected GitHub environment
2. For a GitHub App key, generate a second App private key, encode its PEM, and deploy it before deleting the old key
3. For Turnstile, use the Cloudflare secret-rotation workflow, deploy the replacement, and verify a real challenge before invalidating the old secret
4. For `EXAM_REQUEST_IP_HASH_KEY`, deploy a new independent 32-byte value; understand that current UTC-bucket hashes reset, which can temporarily reset per-client counts
5. Re-run deployment validation, deployment, and the smoke test
6. Revoke or delete the previous credential after verification

Rotate a temporary PAT immediately after use. Rotate any credential at once if
it appears in logs, shell history, artifacts, or a pull request.

## Degraded Upstream and Repository Recovery

Turnstile unavailability returns retryable `503`; challenge rejection returns
non-retryable `403`. GitHub throttling, `5xx` responses, timeouts, and ambiguous
issue-creation outcomes return retryable `503` with `Retry-After`. Other GitHub
failures return `502`. Cosmos DB unavailability and pending reservation waits
return retryable `503`. Before sending the GitHub POST, the service moves the
durable per-exam record into a non-expiring reconciliation state. Retries scan
the repository's open issues page by page for the stable marker and never send
another POST while that state remains unresolved. If the pagination safety cap
is reached, reconciliation fails closed with a retryable response instead of
treating the marker as absent. Pull requests returned by the GitHub issues
listing endpoint are ignored.

When GitHub throttles installation-token or issue requests, wait for GitHub's
rate-limit reset or `Retry-After`, verify the App installation remains active,
and retry with the same request idempotency key. Do not bypass the limit with a
broader credential.

After a repository rename or transfer:

1. Verify or reinstall the GitHub App on the renamed repository
2. Update `EXAM_REQUEST_GITHUB_OWNER` and `EXAM_REQUEST_GITHUB_REPOSITORY`
3. Update the frontend's strict GitHub issue URL allowlist to the same owner and repository before rebuilding
4. Confirm the `exam-request` label and assignee are still available
5. Redeploy, then test both issue-state lookup and creation

If the repository is archived, unarchive it before accepting requests. Verify
App access and label/assignee configuration, then retry. Do not point production
at a replacement repository until the durable Cosmos mappings and expected
issue URLs have been reviewed; old mappings refer to issue numbers in the
original repository.

## Local template validation

The main template is [main.bicep](main.bicep). Development and production examples are under [environments](environments). Compile the template and both parameter files before opening a pull request. Subscription-backed `validate` and `what-if` operations run only in the protected deployment job because they require Azure access.

## Deployment Smoke Test

After the dev deployment and before production rollout:

1. Confirm the Pages build uses the dev API base URL and a Turnstile sitekey registered for the test hostname
2. Submit one requestable exam through the browser
3. Confirm exactly one open issue has the expected `Request exam: CODE` title, Microsoft Learn link, `exam-request` label, and `sifiadlene` assignee
4. Submit the same exam again and confirm the API returns the existing issue without creating a duplicate
5. Confirm the Application Insights trace contains only the exam code and trace ID, with no IP address, Turnstile token, App key, installation token, or GitHub response body
6. Confirm `@sifiadlene` receives GitHub's assignment email under the configured notification policy
7. Close and delete the smoke-test issue if repository policy permits deletion; otherwise close it and remove any test-only content
8. Check the five exam-request alert rules and send a test notification through the action group

Record the issue URL, trace ID, deployment run, and notification result in the
release evidence. Do not proceed to production if issue creation, deduplication,
secret redaction, or notification delivery fails.
