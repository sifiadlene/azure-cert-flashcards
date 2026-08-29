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
          name: 'FUNCTIONS_EXTENSION_VERSION'
          value: '~4'
        }
        {
          name: 'FUNCTIONS_NODE_BLOCK_ON_ENTRY_POINT_ERROR'
          value: 'true'
        }
        {
          name: 'FUNCTIONS_WORKER_RUNTIME'
          value: 'node'
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
