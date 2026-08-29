import { resolve } from 'node:path'
import { CosmosRoomRepository, type CosmosRoomRepositoryConfiguration } from '../adapters/cosmosRoomRepository'
import { FileDeckRepository } from '../adapters/fileDeckRepository'
import { InMemoryRoomRepository } from '../adapters/inMemoryRoomRepository'
import {
  CryptoIdGenerator,
  CryptoRandomSource,
  PepperedCapabilityTokenService,
  SystemClock,
} from '../adapters/system'
import { ChallengeService } from './challengeService'
import type { RoomRepository } from './ports'

let localService: ChallengeService | undefined

type Environment = Readonly<Record<string, string | undefined>>

function required(environment: Environment, name: string): string {
  const value = environment[name]?.trim()
  if (!value) throw new Error(`${name} is required when CHALLENGE_LOCAL_IN_MEMORY is not true.`)
  return value
}

function retentionSeconds(environment: Environment): number {
  const value = Number(environment.CHALLENGE_RETENTION_SECONDS ?? '86400')
  if (!Number.isInteger(value) || value < 300 || value > 2_147_483_647) {
    throw new Error('CHALLENGE_RETENTION_SECONDS must be an integer between 300 and 2147483647.')
  }
  return value
}

export function cosmosConfiguration(environment: Environment): CosmosRoomRepositoryConfiguration {
  const connectionString = environment.CHALLENGE_COSMOS_EMULATOR_CONNECTION_STRING?.trim()
  if (connectionString && environment.NODE_ENV !== 'development' && environment.NODE_ENV !== 'test') {
    throw new Error('CHALLENGE_COSMOS_EMULATOR_CONNECTION_STRING is for local development only.')
  }
  return {
    endpoint: connectionString ? undefined : required(environment, 'CHALLENGE_COSMOS_ENDPOINT'),
    connectionString,
    databaseId: required(environment, 'CHALLENGE_COSMOS_DATABASE'),
    roomsContainerId: required(environment, 'CHALLENGE_COSMOS_ROOMS_CONTAINER'),
    roomCodesContainerId: required(environment, 'CHALLENGE_COSMOS_ROOM_CODES_CONTAINER'),
  }
}

export function createChallengeServiceFromEnvironment(
  environment: Environment,
  cosmosFactory: (configuration: CosmosRoomRepositoryConfiguration) => RoomRepository = CosmosRoomRepository.fromConfiguration,
): ChallengeService {
  const pepper = environment.CHALLENGE_TOKEN_PEPPER
  if (!pepper) {
    throw new Error('CHALLENGE_TOKEN_PEPPER is required.')
  }
  const deckDirectory = resolve(process.cwd(), environment.CHALLENGE_DECK_DIRECTORY ?? 'data/decks')
  const roomRepository = environment.CHALLENGE_LOCAL_IN_MEMORY === 'true'
    ? new InMemoryRoomRepository()
    : cosmosFactory(cosmosConfiguration(environment))
  return new ChallengeService(
    roomRepository,
    new FileDeckRepository(deckDirectory),
    new SystemClock(),
    new CryptoIdGenerator(),
    new CryptoRandomSource(),
    new PepperedCapabilityTokenService(Buffer.from(pepper, 'base64')),
    undefined,
    { retentionSeconds: retentionSeconds(environment) },
  )
}

export function getChallengeService(): ChallengeService {
  if (!localService) {
    localService = createChallengeServiceFromEnvironment(process.env)
  }
  return localService
}
