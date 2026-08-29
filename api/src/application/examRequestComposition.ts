import { resolve } from 'node:path'
import { CosmosExamRequestRepository, type CosmosExamRequestRepositoryConfiguration } from '../adapters/cosmosExamRequestRepository'
import { GitHubAppIssues } from '../adapters/githubIssues'
import { CloudflareTurnstileVerifier } from '../adapters/turnstileVerifier'
import { loadExamCatalog } from './examCatalog'
import type { ExamRequestRepository, ExamRequestTelemetry } from './examRequestPorts'
import { ExamRequestService } from './examRequestService'

type Environment = Readonly<Record<string, string | undefined>>

let service: Promise<ExamRequestService> | undefined

function required(environment: Environment, name: string): string {
  const value = environment[name]?.trim()
  if (!value) throw new Error(`${name} is required for the exam-request route.`)
  return value
}

function positiveInteger(environment: Environment, name: string, defaultValue: number, maximum: number): number {
  const value = Number(environment[name] ?? defaultValue)
  if (!Number.isInteger(value) || value < 1 || value > maximum) {
    throw new Error(`${name} must be an integer between 1 and ${maximum}.`)
  }
  return value
}

function decodeSecret(environment: Environment, name: string): Buffer {
  const encoded = required(environment, name)
  const value = Buffer.from(encoded, 'base64')
  if (value.byteLength < 32 || value.toString('base64').replace(/=+$/, '') !== encoded.replace(/=+$/, '')) {
    throw new Error(`${name} must be a valid base64-encoded value of at least 32 bytes.`)
  }
  return value
}

export function examRequestCosmosConfiguration(environment: Environment): CosmosExamRequestRepositoryConfiguration {
  const connectionString = environment.EXAM_REQUEST_COSMOS_EMULATOR_CONNECTION_STRING?.trim()
  if (connectionString && environment.NODE_ENV !== 'development' && environment.NODE_ENV !== 'test') {
    throw new Error('EXAM_REQUEST_COSMOS_EMULATOR_CONNECTION_STRING is for local development only.')
  }
  return {
    endpoint: connectionString ? undefined : required(environment, 'EXAM_REQUEST_COSMOS_ENDPOINT'),
    connectionString,
    databaseId: required(environment, 'EXAM_REQUEST_COSMOS_DATABASE'),
    containerId: required(environment, 'EXAM_REQUEST_COSMOS_CONTAINER'),
  }
}

const consoleTelemetry: ExamRequestTelemetry = {
  track(name, properties) {
    console.info(name, properties)
  },
}

export async function createExamRequestServiceFromEnvironment(
  environment: Environment,
  repositoryFactory: (configuration: CosmosExamRequestRepositoryConfiguration) => ExamRequestRepository = CosmosExamRequestRepository.fromConfiguration,
  telemetry: ExamRequestTelemetry = consoleTelemetry,
): Promise<ExamRequestService> {
  const privateKey = decodeSecret(environment, 'EXAM_REQUEST_GITHUB_PRIVATE_KEY_BASE64').toString('utf8')
  if (!privateKey.includes('BEGIN') || !privateKey.includes('PRIVATE KEY')) {
    throw new Error('EXAM_REQUEST_GITHUB_PRIVATE_KEY_BASE64 must decode to a PEM private key.')
  }
  const hostnames = required(environment, 'EXAM_REQUEST_TURNSTILE_HOSTNAMES')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
  if (hostnames.length === 0) throw new Error('EXAM_REQUEST_TURNSTILE_HOSTNAMES must contain at least one hostname.')

  const repository = repositoryFactory(examRequestCosmosConfiguration(environment))
  const catalog = await loadExamCatalog(resolve(process.cwd(), 'data'), {
    catalogPath: resolve(process.cwd(), required(environment, 'EXAM_REQUEST_CATALOG_PATH')),
    supportedCodesPath: resolve(process.cwd(), required(environment, 'EXAM_REQUEST_SUPPORTED_CODES_PATH')),
  })
  return new ExamRequestService(
    catalog,
    repository,
    new CloudflareTurnstileVerifier({
      secret: required(environment, 'EXAM_REQUEST_TURNSTILE_SECRET'),
      expectedHostnames: hostnames,
      expectedAction: 'exam-request',
      timeoutMs: positiveInteger(environment, 'EXAM_REQUEST_UPSTREAM_TIMEOUT_MS', 5_000, 30_000),
    }),
    new GitHubAppIssues({
      appId: required(environment, 'EXAM_REQUEST_GITHUB_APP_ID'),
      installationId: required(environment, 'EXAM_REQUEST_GITHUB_INSTALLATION_ID'),
      privateKey,
      owner: required(environment, 'EXAM_REQUEST_GITHUB_OWNER'),
      repository: required(environment, 'EXAM_REQUEST_GITHUB_REPOSITORY'),
      assignee: required(environment, 'EXAM_REQUEST_GITHUB_ASSIGNEE'),
      timeoutMs: positiveInteger(environment, 'EXAM_REQUEST_UPSTREAM_TIMEOUT_MS', 5_000, 30_000),
    }),
    decodeSecret(environment, 'EXAM_REQUEST_IP_HASH_KEY'),
    telemetry,
    {
      pendingTtlSeconds: positiveInteger(environment, 'EXAM_REQUEST_PENDING_TTL_SECONDS', 120, 3_600),
      pendingWaitMs: positiveInteger(environment, 'EXAM_REQUEST_PENDING_WAIT_MS', 4_000, 15_000),
      rateLimit: positiveInteger(environment, 'EXAM_REQUEST_RATE_LIMIT', 3, 100),
    },
  )
}

export function getExamRequestService(): Promise<ExamRequestService> {
  service ??= createExamRequestServiceFromEnvironment(process.env)
  return service
}