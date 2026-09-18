metadata name = 'Cosmos DB Private Endpoint'
metadata description = 'Deploys a private endpoint and DNS zone group for the challenge Cosmos DB for NoSQL account.'

targetScope = 'resourceGroup'

/*
 * Common parameters
 */

@description('Azure region for the private endpoint.')
param location string

@description('Resource tags applied to the private endpoint.')
param tags object

/*
 * Cosmos DB parameters
 */

@description('Existing Azure Cosmos DB account name.')
param cosmosAccountName string

/*
 * Networking parameters
 */

@description('Resource ID of the Azure Cosmos DB private DNS zone.')
param cosmosPrivateDnsZoneId string

@description('Resource ID of the dedicated private endpoint subnet.')
param privateEndpointSubnetId string

/*
 * Resources
 */

resource cosmosAccount 'Microsoft.DocumentDB/databaseAccounts@2025-04-15' existing = {
  name: cosmosAccountName
}

resource privateEndpoint 'Microsoft.Network/privateEndpoints@2024-05-01' = {
  name: 'pep-${cosmosAccountName}-sql'
  location: location
  tags: tags
  properties: {
    privateLinkServiceConnections: [
      {
        name: '${cosmosAccountName}-sql'
        properties: {
          groupIds: [
            'Sql'
          ]
          privateLinkServiceId: cosmosAccount.id
        }
      }
    ]
    subnet: {
      id: privateEndpointSubnetId
    }
  }
}

resource privateDnsZoneGroup 'Microsoft.Network/privateEndpoints/privateDnsZoneGroups@2024-05-01' = {
  parent: privateEndpoint
  name: 'default'
  properties: {
    privateDnsZoneConfigs: [
      {
        name: 'cosmos-zone'
        properties: {
          privateDnsZoneId: cosmosPrivateDnsZoneId
        }
      }
    ]
  }
}

/*
 * Outputs
 */

@description('Resource ID of the Cosmos DB private endpoint.')
output privateEndpointId string = privateEndpoint.id
