import { z } from 'zod'
import { CHALLENGE_PROTOCOL_VERSION } from '../../../web/src/challenge/contracts'

const identifier = z.string().min(8).max(128).regex(/^[A-Za-z0-9._:-]+$/)

export const metadataSchema = z.object({
  protocolVersion: z.literal(CHALLENGE_PROTOCOL_VERSION),
  commandId: identifier,
  idempotencyKey: identifier,
  expectedRoomVersion: z.number().int().nonnegative().nullable(),
}).strict()

const scopeSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('all') }).strict(),
  z.object({ kind: z.literal('domain'), domain: z.string().min(1).max(100) }).strict(),
])

export const createRoomSchema = z.object({
  metadata: metadataSchema,
  hostNickname: z.string().max(100),
  settings: z.object({
    examSlug: z.string().max(50),
    deckVersion: z.string().max(20),
    scope: scopeSchema,
    questionCount: z.union([z.literal(5), z.literal(10), z.literal(20)]),
    timerSeconds: z.union([z.literal(15), z.literal(30), z.literal(60)]),
  }).strict(),
}).strict()

export const joinRoomSchema = z.object({
  metadata: metadataSchema,
  nickname: z.string().max(100),
}).strict()

export const commandSchema = z.object({ metadata: metadataSchema }).strict()
export const answerSchema = z.object({
  metadata: metadataSchema,
  roundIndex: z.number().int().nonnegative(),
  selectedOption: z.enum(['A', 'B', 'C']),
}).strict()
export const reconcileSchema = z.object({
  metadata: metadataSchema,
  roundIndex: z.number().int().nonnegative(),
}).strict()
