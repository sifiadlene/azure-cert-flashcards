metadata name = 'Challenge Function App'
metadata description = 'Deploys a Node.js Azure Functions Flex Consumption app with managed-identity storage access and exact-origin CORS.'

targetScope = 'resourceGroup'

/*
 * Common parameters
 */

@description('Azure region for the Function App and Flex Consumption plan.')
param location string

@description('Resource tags applied to the Function App and plan.')
param tags object

/*
 * Compute parameters
 */

@description('Exact browser origins allowed to call the API. Wildcards are not accepted.')
@minLength(1)
param allowedOrigins string[]

@description('Optional count of always-ready instances for the HTTP trigger group.')
@minValue(0)
@maxValue(20)
param alwaysReadyInstanceCount int

@description('Function App name containing at most 60 characters.')
@minLength(2)
@maxLength(60)
param functionAppName string

@description('Memory in MB for each Flex Consumption instance.')
@allowed([
  512
  2048
  4096
])
param instanceMemoryMb int

@description('Maximum on-demand Flex Consumption instances per function scale group.')
@minValue(1)
@maxValue(1000)
param maximumInstanceCount int

@description('Flex Consumption App Service plan name containing at most 40 characters.')
@minLength(1)
@maxLength(40)
param planName string

/*
 * Storage parameters
 */

@description('Blob endpoint for the Flex Consumption deployment package container.')
param deploymentContainerEndpoint string

@description('Existing Functions runtime and deployment storage account name.')
@minLength(3)
@maxLength(24)
param storageAccountName string

/*
 * Monitoring parameters
 */

@description('Application Insights connection string.')
param applicationInsightsConnectionString string

/*
 * Application parameters
 */

@description('Cosmos DB account endpoint used with the Function system-assigned identity.')
param cosmosEndpoint string

@description('Cosmos DB for NoSQL database name.')
param databaseName string

@description('Packaged canonical deck directory relative to the Function App root.')
param deckDirectory string

@description('Packaged canonical exam catalog path relative to the Function App root.')
param examRequestCatalogPath string

@description('Exam-request state container name.')
param examRequestsContainerName string

@description('GitHub account that owns the exam-request repository.')
param examRequestGitHubOwner string

@description('GitHub repository that receives exam-request issues.')
param examRequestGitHubRepository string

@description('GitHub user assigned to created exam-request issues.')
param examRequestGitHubAssignee string

@description('GitHub App identifier used to mint installation tokens.')
param examRequestGitHubAppId string

@description('GitHub App installation identifier scoped to the target repository.')
param examRequestGitHubInstallationId string

@description('Base64-encoded GitHub App PEM private key.')
@secure()
param examRequestGitHubPrivateKeyBase64 string

@description('Base64-encoded HMAC key used to hash client addresses for rate limiting.')
@secure()
param examRequestIpHashKey string

@description('Maximum accepted first-time exam requests per client address and UTC day.')
@minValue(1)
@maxValue(100)
param examRequestRateLimit int

@description('Pending exam-request reservation retention in seconds.')
@minValue(1)
@maxValue(3600)
param examRequestPendingTtlSeconds int

@description('Maximum time in milliseconds to wait for another request to complete.')
@minValue(1)
@maxValue(15000)
param examRequestPendingWaitMs int

@description('Turnstile hostnames accepted for exam-request verification.')
@minLength(1)
param examRequestTurnstileHostnames string[]

@description('Cloudflare Turnstile secret used only by the Function App.')
@secure()
param examRequestTurnstileSecret string

@description('Packaged supported-exam code artifact path relative to the Function App root.')
param examRequestSupportedCodesPath string

@description('Timeout in milliseconds for Turnstile and GitHub requests.')
@minValue(1)
@maxValue(30000)
param examRequestUpstreamTimeoutMs int

@description('Room-code lookup container name.')
param roomCodesContainerName string

@description('Room inactivity retention and per-item TTL in seconds.')
@minValue(300)
@maxValue(2147483647)
param retentionSeconds int

@description('Room aggregate container name.')
param roomsContainerName string

@description('Base64-encoded pepper used to hash opaque room capability tokens.')
@secure()
param tokenPepper string

/*
 * Variables
 */

var storageBlobDataOwnerRoleId = subscriptionResourceId('Microsoft.Authorization/roleDefinitions', 'b7e6dc6d-f1e8-4753-8033-0f276bb0955b')
var storageQueueDataContributorRoleId = subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '974c5e8b-45b9-4653-ba55-5f855dd0fb88')
var storageTableDataContributorRoleId = subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '0a9a7e1f-b9d0-4cc4-a60d-0319b160aaa3')

/*
 * Resources
 */

resource storageAccount 'Microsoft.Storage/storageAccounts@2025-06-01' existing = {
  name: storageAccountName
}

resource plan 'Microsoft.Web/serverfarms@2024-11-01' = {
  name: planName
  location: location
  tags: tags
  kind: 'functionapp'
  sku: {
    name: 'FC1'
    tier: 'FlexConsumption'
  }
  properties: {
    reserved: true
    zoneRedundant: false
  }
}

resource functionApp 'Microsoft.Web/sites@2024-11-01' = {
  name: functionAppName
  location: location
  tags: tags
  kind: 'functionapp,linux'
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    clientCertEnabled: false
    functionAppConfig: {
      deployment: {
        storage: {
          authentication: {
            type: 'SystemAssignedIdentity'
          }
          type: 'blobContainer'
          value: deploymentContainerEndpoint
        }
      }
      runtime: {
        name: 'node'
        version: '22'
      }
      scaleAndConcurrency: {
        alwaysReady: alwaysReadyInstanceCount > 0 ? [
          {
            instanceCount: alwaysReadyInstanceCount
            name: 'http'
          }
        ] : []
        instanceMemoryMB: instanceMemoryMb
        maximumInstanceCount: maximumInstanceCount
      }
    }
    httpsOnly: true
    publicNetworkAccess: 'Enabled'
    serverFarmId: plan.id
    siteConfig: {
      alwaysOn: false
      appSettings: [
        {
          name: 'APPLICATIONINSIGHTS_CONNECTION_STRING'
          value: applicationInsightsConnectionString
        }
        {
          name: 'AzureWebJobsStorage__accountName'
          value: storageAccount.name
        }
        {
          name: 'AzureWebJobsStorage__credential'
          value: 'managedidentity'
        }
        {
          name: 'CHALLENGE_COSMOS_DATABASE'
          value: databaseName
        }
        {
          name: 'CHALLENGE_COSMOS_ENDPOINT'
          value: cosmosEndpoint
        }
        {
          name: 'CHALLENGE_COSMOS_ROOMS_CONTAINER'
          value: roomsContainerName
        }
        {
          name: 'CHALLENGE_COSMOS_ROOM_CODES_CONTAINER'
          value: roomCodesContainerName
        }
        {
          name: 'CHALLENGE_DECK_DIRECTORY'
          value: deckDirectory
        }
        {
          name: 'CHALLENGE_LOCAL_IN_MEMORY'
          value: 'false'
        }
        {
          name: 'CHALLENGE_RETENTION_SECONDS'
          value: string(retentionSeconds)
        }
        {
          name: 'CHALLENGE_TOKEN_PEPPER'
          value: tokenPepper
        }
        {
          name: 'EXAM_REQUEST_COSMOS_CONTAINER'
          value: examRequestsContainerName
        }
        {
          name: 'EXAM_REQUEST_COSMOS_DATABASE'
          value: databaseName
        }
        {
          name: 'EXAM_REQUEST_COSMOS_ENDPOINT'
          value: cosmosEndpoint
        }
        {
          name: 'EXAM_REQUEST_CATALOG_PATH'
          value: examRequestCatalogPath
        }
        {
          name: 'EXAM_REQUEST_GITHUB_APP_ID'
          value: examRequestGitHubAppId
        }
        {
          name: 'EXAM_REQUEST_GITHUB_ASSIGNEE'
          value: examRequestGitHubAssignee
        }
        {
          name: 'EXAM_REQUEST_GITHUB_INSTALLATION_ID'
          value: examRequestGitHubInstallationId
        }
        {
          name: 'EXAM_REQUEST_GITHUB_OWNER'
          value: examRequestGitHubOwner
        }
        {
          name: 'EXAM_REQUEST_GITHUB_PRIVATE_KEY_BASE64'
          value: examRequestGitHubPrivateKeyBase64
        }
        {
          name: 'EXAM_REQUEST_GITHUB_REPOSITORY'
          value: examRequestGitHubRepository
        }
        {
          name: 'EXAM_REQUEST_IP_HASH_KEY'
          value: examRequestIpHashKey
        }
        {
          name: 'EXAM_REQUEST_PENDING_TTL_SECONDS'
          value: string(examRequestPendingTtlSeconds)
        }
        {
          name: 'EXAM_REQUEST_PENDING_WAIT_MS'
          value: string(examRequestPendingWaitMs)
        }
        {
          name: 'EXAM_REQUEST_RATE_LIMIT'
          value: string(examRequestRateLimit)
        }
        {
          name: 'EXAM_REQUEST_SUPPORTED_CODES_PATH'
          value: examRequestSupportedCodesPath
        }
        {
          name: 'EXAM_REQUEST_TURNSTILE_HOSTNAMES'
          value: join(examRequestTurnstileHostnames, ',')
        }
        {
          name: 'EXAM_REQUEST_TURNSTILE_SECRET'
          value: examRequestTurnstileSecret
        }
        {
          name: 'EXAM_REQUEST_UPSTREAM_TIMEOUT_MS'
          value: string(examRequestUpstreamTimeoutMs)
        }
        {
          name: 'FUNCTIONS_EXTENSION_VERSION'
          value: '~4'
        }
        {
          name: 'FUNCTIONS_NODE_BLOCK_ON_ENTRY_POINT_ERROR'
          value: 'true'
        }
        {
          name: 'NODE_ENV'
          value: 'production'
        }
      ]
      cors: {
        allowedOrigins: allowedOrigins
        supportCredentials: false
      }
      ftpsState: 'Disabled'
      http20Enabled: true
      minTlsVersion: '1.2'
      remoteDebuggingEnabled: false
    }
  }
}

resource ftpBasicAuthPolicy 'Microsoft.Web/sites/basicPublishingCredentialsPolicies@2024-11-01' = {
  parent: functionApp
  name: 'ftp'
  properties: {
    allow: false
  }
}

resource scmBasicAuthPolicy 'Microsoft.Web/sites/basicPublishingCredentialsPolicies@2024-11-01' = {
  parent: functionApp
  name: 'scm'
  properties: {
    allow: false
  }
}

resource storageBlobRoleAssignment 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(storageAccount.id, functionApp.id, storageBlobDataOwnerRoleId)
  scope: storageAccount
  properties: {
    principalId: functionApp.identity.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: storageBlobDataOwnerRoleId
  }
}

resource storageQueueRoleAssignment 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(storageAccount.id, functionApp.id, storageQueueDataContributorRoleId)
  scope: storageAccount
  properties: {
    principalId: functionApp.identity.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: storageQueueDataContributorRoleId
  }
}

resource storageTableRoleAssignment 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(storageAccount.id, functionApp.id, storageTableDataContributorRoleId)
  scope: storageAccount
  properties: {
    principalId: functionApp.identity.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: storageTableDataContributorRoleId
  }
}

/*
 * Outputs
 */

@description('Public HTTPS base URL for the Function App.')
output functionAppBaseUrl string = 'https://${functionApp.properties.defaultHostName}'

@description('Function App name used by code deployment automation.')
output functionAppName string = functionApp.name

@description('Function App system-assigned managed identity principal ID.')
output functionPrincipalId string = functionApp.identity.principalId
