metadata name = 'Certification Flashcards Challenge Infrastructure'
metadata description = 'Orchestrates the minimal Azure Functions, Cosmos DB, storage, and monitoring footprint for multiplayer challenges.'

targetScope = 'resourceGroup'

/*
 * Common parameters
 */

@description('Deployment environment used in names and tags.')
@allowed([
  'dev'
  'test'
  'prod'
])
param environment string

@description('Azure region for all resources. Choose a region that supports Flex Consumption and serverless Cosmos DB.')
param location string

@description('Short lowercase resource prefix containing letters, numbers, or hyphens.')
@minLength(2)
@maxLength(12)
param resourcePrefix string

@description('Short lowercase deployment instance containing letters or numbers.')
@minLength(1)
@maxLength(4)
param instance string

@description('Additional non-secret resource tags merged with the standard tags.')
param tags object = {}

/*
 * Compute parameters
 */

@description('Exact HTTPS browser origins allowed by Function CORS. Wildcards are prohibited.')
@minLength(1)
param allowedOrigins string[]

@description('Optional always-ready instance count for the HTTP trigger group. Zero allows scale to zero.')
@minValue(0)
@maxValue(20)
param alwaysReadyInstanceCount int = 0

@description('Flex Consumption instance memory in MB.')
@allowed([
  512
  2048
  4096
])
param functionInstanceMemoryMb int = 2048

@description('Maximum on-demand Flex Consumption instances per function scale group.')
@minValue(1)
@maxValue(1000)
param functionMaximumInstanceCount int = 20

/*
 * Data parameters
 */

@description('Default and maximum per-item Cosmos DB retention period in seconds.')
@minValue(300)
@maxValue(2147483647)
param cosmosTtlSeconds int = 86400

/*
 * Security parameters
 */

@description('Base64-encoded random pepper used to hash opaque capability tokens. Supply only at deployment time.')
@secure()
param challengeTokenPepper string

/*
 * Variables
 */

var nameStem = '${resourcePrefix}-${environment}-${instance}'
var compactNameStem = toLower(replace(nameStem, '-', ''))
var uniqueness = take(uniqueString(subscription().id, resourceGroup().id, nameStem), 6)
var storageAccountName = take('st${compactNameStem}${uniqueness}', 24)
var functionAppName = take('func-${nameStem}-${uniqueness}', 60)
var planName = take('asp-${nameStem}', 40)
var cosmosAccountName = take('cosmos-${nameStem}-${uniqueness}', 44)
var databaseName = 'challenge'
var roomsContainerName = 'rooms'
var roomCodesContainerName = 'room-codes'
var deploymentContainerName = 'function-releases'
var standardTags = union(tags, {
  application: 'certification-flashcards'
  environment: environment
  managedBy: 'bicep'
  workload: 'multiplayer-challenge'
})

/*
 * Modules
 */

module storage 'modules/storage.bicep' = {
  params: {
    deploymentContainerName: deploymentContainerName
    location: location
    storageAccountName: storageAccountName
    tags: standardTags
  }
}

module monitoring 'modules/monitoring.bicep' = {
  params: {
    applicationInsightsName: take('appi-${nameStem}', 260)
    location: location
    logAnalyticsWorkspaceName: take('log-${nameStem}', 63)
    retentionInDays: 30
    tags: standardTags
  }
}

module cosmos 'modules/cosmos.bicep' = {
  params: {
    accountName: cosmosAccountName
    databaseName: databaseName
    location: location
    roomCodesContainerName: roomCodesContainerName
    roomsContainerName: roomsContainerName
    tags: standardTags
    ttlSeconds: cosmosTtlSeconds
  }
}

module functionApp 'modules/function-app.bicep' = {
  params: {
    allowedOrigins: allowedOrigins
    alwaysReadyInstanceCount: alwaysReadyInstanceCount
    applicationInsightsConnectionString: monitoring.outputs.applicationInsightsConnectionString
    cosmosEndpoint: cosmos.outputs.accountEndpoint
    databaseName: cosmos.outputs.databaseName
    deckDirectory: 'data/decks'
    deploymentContainerEndpoint: storage.outputs.deploymentContainerEndpoint
    functionAppName: functionAppName
    instanceMemoryMb: functionInstanceMemoryMb
    location: location
    maximumInstanceCount: functionMaximumInstanceCount
    planName: planName
    roomCodesContainerName: cosmos.outputs.roomCodesContainerName
    retentionSeconds: cosmosTtlSeconds
    roomsContainerName: cosmos.outputs.roomsContainerName
    storageAccountName: storage.outputs.storageAccountName
    tags: standardTags
    tokenPepper: challengeTokenPepper
  }
}

module cosmosAccess 'modules/cosmos-access.bicep' = {
  params: {
    accountName: cosmos.outputs.accountName
    databaseName: cosmos.outputs.databaseName
    functionAppName: functionApp.outputs.functionAppName
    functionPrincipalId: functionApp.outputs.functionPrincipalId
  }
}

/*
 * Outputs
 */

@description('Cosmos DB account endpoint used by the challenge API.')
output cosmosEndpoint string = cosmos.outputs.accountEndpoint

@description('Deployed Function App public API base URL including the Functions route prefix.')
output functionApiBaseUrl string = '${functionApp.outputs.functionAppBaseUrl}/api'

@description('Deployed Function App name used by the API deployment workflow.')
output functionAppName string = functionApp.outputs.functionAppName

@description('Function App system-assigned managed identity principal ID.')
output functionPrincipalId string = functionApp.outputs.functionPrincipalId

@description('Cosmos DB data-plane role assignment resource ID.')
output cosmosRoleAssignmentId string = cosmosAccess.outputs.roleAssignmentId

@description('Runtime and deployment storage account name.')
output storageAccountName string = storage.outputs.storageAccountName
