metadata name = 'Function Storage Private Endpoints'
metadata description = 'Deploys Blob, Queue, and Table private endpoints and DNS zone groups for the Function storage account.'

targetScope = 'resourceGroup'

/*
 * Common parameters
 */

@description('Azure region for the private endpoints.')
param location string

@description('Resource tags applied to the private endpoints.')
param tags object

/*
 * Networking parameters
 */

@description('Resource ID of the Blob private DNS zone.')
param blobPrivateDnsZoneId string

@description('Resource ID of the dedicated private endpoint subnet.')
param privateEndpointSubnetId string

@description('Resource ID of the Queue private DNS zone.')
param queuePrivateDnsZoneId string

@description('Resource ID of the Table private DNS zone.')
param tablePrivateDnsZoneId string

/*
 * Storage parameters
 */

@description('Existing Functions runtime and deployment storage account name.')
@minLength(3)
@maxLength(24)
param storageAccountName string

/*
 * Variables
 */

var services = [
  {
    dnsZoneId: blobPrivateDnsZoneId
    name: 'blob'
  }
  {
    dnsZoneId: queuePrivateDnsZoneId
    name: 'queue'
  }
  {
    dnsZoneId: tablePrivateDnsZoneId
    name: 'table'
  }
]

/*
 * Resources
 */

resource storageAccount 'Microsoft.Storage/storageAccounts@2025-06-01' existing = {
  name: storageAccountName
}

resource privateEndpoints 'Microsoft.Network/privateEndpoints@2024-05-01' = [for service in services: {
  name: 'pep-${storageAccountName}-${service.name}'
  location: location
  tags: tags
  properties: {
    privateLinkServiceConnections: [
      {
        name: '${storageAccountName}-${service.name}'
        properties: {
          groupIds: [
            service.name
          ]
          privateLinkServiceId: storageAccount.id
        }
      }
    ]
    subnet: {
      id: privateEndpointSubnetId
    }
  }
}]

resource privateDnsZoneGroups 'Microsoft.Network/privateEndpoints/privateDnsZoneGroups@2024-05-01' = [for (service, index) in services: {
  parent: privateEndpoints[index]
  name: 'default'
  properties: {
    privateDnsZoneConfigs: [
      {
        name: '${service.name}-zone'
        properties: {
          privateDnsZoneId: service.dnsZoneId
        }
      }
    ]
  }
}]

/*
 * Outputs
 */

@description('Resource IDs of the storage private endpoints.')
output privateEndpointIds string[] = map(privateEndpoints, endpoint => endpoint.id)
