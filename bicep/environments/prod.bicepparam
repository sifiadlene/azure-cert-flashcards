using '../main.bicep'

param environment = 'prod'
param location = 'eastus2'
param resourcePrefix = 'certcards'
param instance = '01'
param alertActionGroupResourceIds = [
  '/subscriptions/00000000-0000-4000-8000-000000000000/resourceGroups/injected-by-deployment-workflow/providers/Microsoft.Insights/actionGroups/injected-by-deployment-workflow'
]
param allowedOrigins = [
  'https://YOUR-ORGANIZATION.github.io'
]
param cosmosTtlSeconds = 86400
param functionInstanceMemoryMb = 2048
param functionMaximumInstanceCount = 20
param alwaysReadyInstanceCount = 0
param challengeTokenPepper = '<injected-by-deployment-workflow>'
param examRequestGitHubAppId = '<injected-by-deployment-workflow>'
param examRequestGitHubInstallationId = '<injected-by-deployment-workflow>'
param examRequestGitHubPrivateKeyBase64 = '<injected-by-deployment-workflow>'
param examRequestGitHubOwner = '<injected-by-deployment-workflow>'
param examRequestGitHubRepository = '<injected-by-deployment-workflow>'
param examRequestGitHubAssignee = '<injected-by-deployment-workflow>'
param examRequestIpHashKey = '<injected-by-deployment-workflow>'
param examRequestTurnstileHostnames = [
  '<injected-by-deployment-workflow>'
]
param examRequestTurnstileSecret = '<injected-by-deployment-workflow>'
param tags = {
  costProfile: 'production'
}
