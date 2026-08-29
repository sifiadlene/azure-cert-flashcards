using '../main.bicep'

param environment = 'prod'
param location = 'eastus2'
param resourcePrefix = 'certcards'
param instance = '01'
param allowedOrigins = [
  'https://YOUR-ORGANIZATION.github.io'
]
param cosmosTtlSeconds = 86400
param functionInstanceMemoryMb = 2048
param functionMaximumInstanceCount = 20
param alwaysReadyInstanceCount = 0
param challengeTokenPepper = '<injected-by-deployment-workflow>'
param tags = {
  costProfile: 'production'
}
