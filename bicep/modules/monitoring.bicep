metadata name = 'Application Monitoring'
metadata description = 'Deploys a Log Analytics workspace and workspace-based Application Insights component.'

targetScope = 'resourceGroup'

/*
 * Common parameters
 */

@description('Azure region for monitoring resources.')
param location string

@description('Resource tags applied to monitoring resources.')
param tags object

/*
 * Monitoring parameters
 */

@description('Application Insights component name containing at most 260 characters.')
@maxLength(260)
param applicationInsightsName string

@description('Log Analytics workspace name containing 4 to 63 characters.')
@minLength(4)
@maxLength(63)
param logAnalyticsWorkspaceName string

@description('Log retention period in days.')
@minValue(30)
@maxValue(730)
param retentionInDays int

/*
 * Resources
 */

resource logAnalyticsWorkspace 'Microsoft.OperationalInsights/workspaces@2025-02-01' = {
  name: logAnalyticsWorkspaceName
  location: location
  tags: tags
  properties: {
    features: {
      enableLogAccessUsingOnlyResourcePermissions: true
    }
    publicNetworkAccessForIngestion: 'Enabled'
    publicNetworkAccessForQuery: 'Enabled'
    retentionInDays: retentionInDays
    sku: {
      name: 'PerGB2018'
    }
  }
}

resource applicationInsights 'Microsoft.Insights/components@2020-02-02' = {
  name: applicationInsightsName
  location: location
  kind: 'web'
  tags: tags
  properties: {
    Application_Type: 'web'
    DisableIpMasking: false
    IngestionMode: 'LogAnalytics'
    RetentionInDays: retentionInDays
    WorkspaceResourceId: logAnalyticsWorkspace.id
    publicNetworkAccessForIngestion: 'Enabled'
    publicNetworkAccessForQuery: 'Enabled'
  }
}

/*
 * Outputs
 */

@description('Application Insights connection string for Function telemetry configuration.')
output applicationInsightsConnectionString string = applicationInsights.properties.ConnectionString

@description('Application Insights resource ID.')
output applicationInsightsId string = applicationInsights.id

@description('Log Analytics workspace resource ID.')
output logAnalyticsWorkspaceId string = logAnalyticsWorkspace.id
