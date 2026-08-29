metadata name = 'Challenge Cosmos DB'
metadata description = 'Deploys a serverless Azure Cosmos DB for NoSQL account, database, and ephemeral room containers.'

targetScope = 'resourceGroup'

/*
 * Common parameters
 */

@description('Azure region for Cosmos DB resources.')
param location string

@description('Resource tags applied to the Cosmos DB account.')
param tags object

/*
 * Cosmos DB parameters
 */

@description('Globally unique Cosmos DB account name containing 3 to 44 lowercase letters, numbers, or hyphens.')
@minLength(3)
@maxLength(44)
param accountName string

@description('Cosmos DB for NoSQL database name.')
@minLength(1)
@maxLength(255)
param databaseName string

@description('Room-code lookup container name.')
@minLength(1)
@maxLength(255)
param roomCodesContainerName string

@description('Room aggregate container name.')
@minLength(1)
@maxLength(255)
param roomsContainerName string

@description('Default and maximum per-item retention period in seconds.')
@minValue(300)
@maxValue(2147483647)
param ttlSeconds int

/*
 * Resources
 */

resource account 'Microsoft.DocumentDB/databaseAccounts@2025-04-15' = {
  name: accountName
  location: location
  tags: tags
  kind: 'GlobalDocumentDB'
  properties: {
    capabilities: [
      {
        name: 'EnableServerless'
      }
    ]
    consistencyPolicy: {
      defaultConsistencyLevel: 'Session'
    }
    databaseAccountOfferType: 'Standard'
    disableKeyBasedMetadataWriteAccess: true
    disableLocalAuth: true
    enableAutomaticFailover: false
    enableFreeTier: false
    locations: [
      {
        failoverPriority: 0
        isZoneRedundant: false
        locationName: location
      }
    ]
    minimalTlsVersion: 'Tls12'
    publicNetworkAccess: 'Enabled'
  }
}

resource database 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases@2025-04-15' = {
  parent: account
  name: databaseName
  properties: {
    resource: {
      id: databaseName
    }
  }
}

resource roomsContainer 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases/containers@2025-04-15' = {
  parent: database
  name: roomsContainerName
  properties: {
    resource: {
      defaultTtl: ttlSeconds
      id: roomsContainerName
      partitionKey: {
        kind: 'Hash'
        paths: [
          '/roomId'
        ]
        version: 2
      }
    }
  }
}

resource roomCodesContainer 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases/containers@2025-04-15' = {
  parent: database
  name: roomCodesContainerName
  properties: {
    resource: {
      defaultTtl: ttlSeconds
      id: roomCodesContainerName
      partitionKey: {
        kind: 'Hash'
        paths: [
          '/roomCode'
        ]
        version: 2
      }
    }
  }
}

/*
 * Outputs
 */

@description('Cosmos DB account endpoint used by the API with managed identity.')
output accountEndpoint string = account.properties.documentEndpoint

@description('Cosmos DB account name.')
output accountName string = account.name

@description('Cosmos DB account resource ID.')
output accountId string = account.id

@description('Cosmos DB for NoSQL database name.')
output databaseName string = database.name

@description('Room-code lookup container name.')
output roomCodesContainerName string = roomCodesContainer.name

@description('Room aggregate container name.')
output roomsContainerName string = roomsContainer.name
