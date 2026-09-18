metadata name = 'Function Private Networking'
metadata description = 'Deploys the VNet, dedicated Flex and private endpoint subnets, and private DNS zones required for private Function storage access.'

targetScope = 'resourceGroup'

/*
 * Common parameters
 */

@description('Azure region for the virtual network.')
param location string

@description('Resource tags applied to the virtual network.')
param tags object

/*
 * Networking parameters
 */

@description('Address prefix for the virtual network.')
param virtualNetworkAddressPrefix string

@description('Address prefix for the dedicated Flex Consumption integration subnet.')
param flexSubnetAddressPrefix string

@description('Address prefix for the dedicated private endpoint subnet.')
param privateEndpointSubnetAddressPrefix string

@description('Virtual network name.')
param virtualNetworkName string

/*
 * Variables
 */

var flexSubnetName = 'snet-flex-integration'
var privateEndpointSubnetName = 'snet-private-endpoints'
var privateDnsZoneNames = [
  'privatelink.blob.${environment().suffixes.storage}'
  'privatelink.queue.${environment().suffixes.storage}'
  'privatelink.table.${environment().suffixes.storage}'
]
var storageServiceNames = [
  'blob'
  'queue'
  'table'
]

/*
 * Resources
 */

resource virtualNetwork 'Microsoft.Network/virtualNetworks@2024-05-01' = {
  name: virtualNetworkName
  location: location
  tags: tags
  properties: {
    addressSpace: {
      addressPrefixes: [
        virtualNetworkAddressPrefix
      ]
    }
  }
}

resource flexSubnet 'Microsoft.Network/virtualNetworks/subnets@2024-05-01' = {
  parent: virtualNetwork
  name: flexSubnetName
  properties: {
    addressPrefix: flexSubnetAddressPrefix
    delegations: [
      {
        name: 'flex-consumption-delegation'
        properties: {
          serviceName: 'Microsoft.App/environments'
        }
      }
    ]
    privateEndpointNetworkPolicies: 'Enabled'
    privateLinkServiceNetworkPolicies: 'Enabled'
  }
}

resource privateEndpointSubnet 'Microsoft.Network/virtualNetworks/subnets@2024-05-01' = {
  parent: virtualNetwork
  name: privateEndpointSubnetName
  properties: {
    addressPrefix: privateEndpointSubnetAddressPrefix
    privateEndpointNetworkPolicies: 'Disabled'
    privateLinkServiceNetworkPolicies: 'Enabled'
  }
}

resource privateDnsZones 'Microsoft.Network/privateDnsZones@2024-06-01' = [for zoneName in privateDnsZoneNames: {
  name: zoneName
  location: 'global'
  tags: tags
}]

resource privateDnsZoneLinks 'Microsoft.Network/privateDnsZones/virtualNetworkLinks@2024-06-01' = [for (serviceName, index) in storageServiceNames: {
  parent: privateDnsZones[index]
  name: '${virtualNetworkName}-${serviceName}-link'
  location: 'global'
  tags: tags
  properties: {
    registrationEnabled: false
    virtualNetwork: {
      id: virtualNetwork.id
    }
  }
}]

/*
 * Outputs
 */

@description('Resource ID of the dedicated Flex Consumption integration subnet.')
output flexSubnetId string = flexSubnet.id

@description('Resource ID of the dedicated private endpoint subnet.')
output privateEndpointSubnetId string = privateEndpointSubnet.id

@description('Resource ID of the Blob private DNS zone.')
output blobPrivateDnsZoneId string = privateDnsZones[0].id

@description('Resource ID of the Queue private DNS zone.')
output queuePrivateDnsZoneId string = privateDnsZones[1].id

@description('Resource ID of the Table private DNS zone.')
output tablePrivateDnsZoneId string = privateDnsZones[2].id
