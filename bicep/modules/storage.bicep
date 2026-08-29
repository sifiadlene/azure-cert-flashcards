metadata name = 'Function Storage'
metadata description = 'Deploys the secure storage account and package container required by Azure Functions Flex Consumption.'

targetScope = 'resourceGroup'

/*
 * Common parameters
 */

@description('Azure region for the storage account.')
param location string

@description('Resource tags applied to the storage account.')
param tags object

/*
 * Storage parameters
 */

@description('Globally unique storage account name containing 3 to 24 lowercase alphanumeric characters.')
@minLength(3)
@maxLength(24)
param storageAccountName string

@description('Blob container name used by Flex Consumption package deployment.')
@minLength(3)
@maxLength(63)
param deploymentContainerName string

/*
 * Resources
 */

resource storageAccount 'Microsoft.Storage/storageAccounts@2025-06-01' = {
  name: storageAccountName
  location: location
  tags: tags
  kind: 'StorageV2'
  sku: {
    name: 'Standard_LRS'
  }
  properties: {
    accessTier: 'Hot'
    allowBlobPublicAccess: false
    allowCrossTenantReplication: false
    allowSharedKeyAccess: false
    defaultToOAuthAuthentication: true
    dnsEndpointType: 'Standard'
    minimumTlsVersion: 'TLS1_2'
    publicNetworkAccess: 'Enabled'
    supportsHttpsTrafficOnly: true
  }
}

resource blobService 'Microsoft.Storage/storageAccounts/blobServices@2025-06-01' = {
  parent: storageAccount
  name: 'default'
  properties: {
    deleteRetentionPolicy: {
      enabled: true
      days: 7
    }
  }
}

resource deploymentContainer 'Microsoft.Storage/storageAccounts/blobServices/containers@2025-06-01' = {
  parent: blobService
  name: deploymentContainerName
  properties: {
    publicAccess: 'None'
  }
}

/*
 * Outputs
 */

@description('Storage account resource ID.')
output storageAccountId string = storageAccount.id

@description('Storage account name.')
output storageAccountName string = storageAccount.name

@description('Blob endpoint for the deployment package container.')
output deploymentContainerEndpoint string = '${storageAccount.properties.primaryEndpoints.blob}${deploymentContainer.name}'
