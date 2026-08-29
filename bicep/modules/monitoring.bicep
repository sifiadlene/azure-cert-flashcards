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

@description('Resource IDs of Azure Monitor action groups notified by exam-request alerts.')
param alertActionGroupResourceIds string[]

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

var examRequestAlertDefinitions = [
  {
    suffix: 'rate-limited'
    displayName: 'Exam requests - rate limiting spike'
    description: 'More than five exam requests were rate limited within 15 minutes.'
    query: 'traces | where message has "exam_request.rate_limited"'
    threshold: 5
    severity: 2
  }
  {
    suffix: 'turnstile-failed'
    displayName: 'Exam requests - Turnstile failures'
    description: 'More than five Turnstile rejections or upstream failures occurred within 15 minutes.'
    query: 'traces | where message has_any ("exam_request.rejected", "exam_request.turnstile_failed")'
    threshold: 5
    severity: 2
  }
  {
    suffix: 'github-failed'
    displayName: 'Exam requests - GitHub failures'
    description: 'At least two GitHub failures occurred within 15 minutes.'
    query: 'traces | where message has "exam_request.github_failed"'
    threshold: 1
    severity: 1
  }
  {
    suffix: 'abnormal-volume'
    displayName: 'Exam requests - abnormal volume'
    description: 'More than 50 exam-request operations occurred within 15 minutes.'
    query: 'traces | where message startswith "exam_request."'
    threshold: 50
    severity: 2
  }
  {
    suffix: 'stale-pending'
    displayName: 'Exam requests - stale pending reservations'
    description: 'At least one stale pending exam-request reservation was observed within 15 minutes.'
    query: 'traces | where message has "exam_request.stale_pending"'
    threshold: 0
    severity: 1
  }
]

resource examRequestAlerts 'Microsoft.Insights/scheduledQueryRules@2023-12-01' = [for definition in examRequestAlertDefinitions: {
  name: take('${applicationInsightsName}-${definition.suffix}', 260)
  location: location
  tags: tags
  kind: 'LogAlert'
  properties: {
    actions: {
      actionGroups: alertActionGroupResourceIds
    }
    autoMitigate: true
    checkWorkspaceAlertsStorageConfigured: false
    criteria: {
      allOf: [
        {
          failingPeriods: {
            minFailingPeriodsToAlert: 1
            numberOfEvaluationPeriods: 1
          }
          operator: 'GreaterThan'
          query: definition.query
          threshold: definition.threshold
          timeAggregation: 'Count'
        }
      ]
    }
    description: definition.description
    displayName: definition.displayName
    enabled: true
    evaluationFrequency: 'PT5M'
    muteActionsDuration: 'PT15M'
    scopes: [
      applicationInsights.id
    ]
    severity: definition.severity
    skipQueryValidation: false
    windowSize: 'PT15M'
  }
}]

/*
 * Outputs
 */

@description('Application Insights connection string for Function telemetry configuration.')
output applicationInsightsConnectionString string = applicationInsights.properties.ConnectionString

@description('Application Insights resource ID.')
output applicationInsightsId string = applicationInsights.id

@description('Log Analytics workspace resource ID.')
output logAnalyticsWorkspaceId string = logAnalyticsWorkspace.id
