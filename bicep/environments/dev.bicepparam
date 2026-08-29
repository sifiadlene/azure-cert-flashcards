using '../main.bicep'

param environment = 'dev'
param location = 'eastus2'
param resourcePrefix = 'certcards'
param instance = '01'
param allowedOrigins = [
  'http://localhost:5173'
  'http://127.0.0.1:5173'
]
param cosmosTtlSeconds = 86400
param functionInstanceMemoryMb = 512
param functionMaximumInstanceCount = 5
param alwaysReadyInstanceCount = 0
param challengeTokenPepper = '<injected-by-deployment-workflow>'
param tags = {
  costProfile: 'development'
}
