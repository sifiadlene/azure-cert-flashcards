---
title: Challenge API Azure deployment
description: Configuration and deployment requirements for the multiplayer challenge Azure resources and Function App.
ms.date: 2026-08-28
ms.topic: how-to
---

## Resource footprint

The resource-group deployment creates only the challenge API dependencies:

* One Linux Azure Functions Flex Consumption FC1 plan and Node.js 22 Function App
* One StorageV2 account for Functions host state and Flex deployment packages
* One serverless Azure Cosmos DB for NoSQL account, database, rooms container, and room-code lookup container
* One Log Analytics workspace and workspace-based Application Insights component
* Storage control-plane role assignments required by the Functions host
* A database-scoped custom Cosmos DB data-plane role and assignment for the Function system-assigned identity

The rooms container uses `/roomId`. The room-code lookup container uses `/roomCode`. Both enable TTL with the configured retention period, which defaults to 86,400 seconds. The same value is supplied to the Function App as `CHALLENGE_RETENTION_SECONDS`, so application expiry checks and every room, mapping, receipt, and answer marker use one validated retention period.

## GitHub environment configuration

Create a protected GitHub environment named `production`. Configure these environment or repository variables:

* `AZURE_CLIENT_ID`: Client ID of the Microsoft Entra application or user-assigned identity used for GitHub OIDC
* `AZURE_TENANT_ID`: Microsoft Entra tenant ID
* `AZURE_SUBSCRIPTION_ID`: Target Azure subscription ID
* `AZURE_RESOURCE_GROUP`: Existing target resource group
* `AZURE_LOCATION`: Azure region supporting Flex Consumption and serverless Cosmos DB
* `AZURE_ALLOWED_ORIGINS_JSON`: JSON array of exact HTTPS origins, such as `["https://example.github.io"]`
* `VITE_PUBLIC_API_BASE`: Deployed `functionApiBaseUrl` output used by the Pages workflow

Configure `CHALLENGE_TOKEN_PEPPER` as an environment secret. Generate at least 32 random bytes and encode them as Base64. The example parameter files contain a non-secret marker because Bicep requires every mandatory parameter to have an assignment. The workflow validates and overrides that marker at deployment time. Never commit the real value or expose it as a Bicep output.

The OIDC principal needs resource deployment access in the target resource group, permission to create Azure role assignments on the Functions storage account, and permission to create Cosmos DB SQL role definitions and assignments. Scope these permissions to the target resource group where possible.

## Deployment behavior

Pull requests and branch pushes run API tests, web tests, the full Playwright suite, checked-in data validation, application builds, package assembly, and Bicep compilation. Pull requests never deploy.

A push to `main` or a manual workflow dispatch runs the same validation before signing in through GitHub OIDC. It then validates and previews Bicep, deploys the resource-group template, and publishes only the API package. The package contains compiled JavaScript, production dependencies, `host.json`, and copied canonical English deck artifacts.

The target resource group must exist before the workflow runs. Resource-group creation and Azure deployment are intentionally not performed during local validation.

## Local template validation

The main template is [main.bicep](main.bicep). Development and production examples are under [environments](environments). Compile the template and both parameter files before opening a pull request. Subscription-backed `validate` and `what-if` operations run only in the protected deployment job because they require Azure access.
