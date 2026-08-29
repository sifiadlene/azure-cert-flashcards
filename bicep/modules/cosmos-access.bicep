metadata name = 'Challenge Cosmos DB Access'
metadata description = 'Grants the Function managed identity database-scoped read, write, query, and transactional batch access.'

targetScope = 'resourceGroup'

/*
 * Cosmos DB parameters
 */

@description('Existing Cosmos DB account name.')
param accountName string

@description('Cosmos DB for NoSQL database name used to scope data access.')
param databaseName string

/*
 * Identity parameters
 */

@description('Function App name used to create a stable role assignment identifier.')
param functionAppName string

@description('Function App system-assigned managed identity principal ID.')
param functionPrincipalId string

/*
 * Variables
 */

var roleDefinitionGuid = guid(account.id, 'challenge-data-contributor-v1')

/*
 * Resources
 */

resource account 'Microsoft.DocumentDB/databaseAccounts@2025-04-15' existing = {
  name: accountName
}

resource challengeDataRole 'Microsoft.DocumentDB/databaseAccounts/sqlRoleDefinitions@2025-04-15' = {
  parent: account
  name: roleDefinitionGuid
  properties: {
    assignableScopes: [
      account.id
    ]
    permissions: [
      {
        dataActions: [
          'Microsoft.DocumentDB/databaseAccounts/readMetadata'
          'Microsoft.DocumentDB/databaseAccounts/sqlDatabases/containers/*'
          'Microsoft.DocumentDB/databaseAccounts/sqlDatabases/containers/items/*'
        ]
      }
    ]
    roleName: 'Challenge API data contributor'
    type: 'CustomRole'
  }
}

resource challengeDataRoleAssignment 'Microsoft.DocumentDB/databaseAccounts/sqlRoleAssignments@2025-04-15' = {
  parent: account
  name: guid(account.id, functionAppName, roleDefinitionGuid, databaseName)
  properties: {
    principalId: functionPrincipalId
    roleDefinitionId: challengeDataRole.id
    scope: '${account.id}/dbs/${databaseName}'
  }
}

/*
 * Outputs
 */

@description('Cosmos DB data-plane role assignment resource ID.')
output roleAssignmentId string = challengeDataRoleAssignment.id

@description('Custom Cosmos DB data-plane role definition resource ID.')
output roleDefinitionId string = challengeDataRole.id
