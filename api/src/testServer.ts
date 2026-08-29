import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { createChallengeServiceFromEnvironment } from './application/composition'
import { createChallengeHandlers } from './http/handlers'

if (process.env.NODE_ENV !== 'test') {
  throw new Error('The challenge HTTP adapter can only run with NODE_ENV=test.')
}

const environment = {
  ...process.env,
  CHALLENGE_LOCAL_IN_MEMORY: 'true',
  CHALLENGE_TOKEN_PEPPER: process.env.CHALLENGE_TOKEN_PEPPER ?? Buffer.alloc(32, 7).toString('base64'),
  CHALLENGE_DECK_DIRECTORY: process.env.CHALLENGE_DECK_DIRECTORY ?? 'data/decks',
}
const handlers = createChallengeHandlers(createChallengeServiceFromEnvironment(environment))
const context = { error: console.error } as unknown as InvocationContext

type HandlerName = keyof typeof handlers

interface Route {
  method: string
  pattern: RegExp
  params: string[]
  handler: HandlerName
}

const routes: Route[] = [
  { method: 'POST', pattern: /^\/api\/rooms$/, params: [], handler: 'createRoom' },
  { method: 'POST', pattern: /^\/api\/rooms\/([^/]+)\/join$/, params: ['roomCode'], handler: 'joinRoom' },
  { method: 'POST', pattern: /^\/api\/rooms\/([^/]+)\/resume$/, params: ['roomCode'], handler: 'resumePlayer' },
  { method: 'GET', pattern: /^\/api\/rooms\/([^/]+)$/, params: ['roomId'], handler: 'getSnapshot' },
  { method: 'POST', pattern: /^\/api\/rooms\/([^/]+)\/start$/, params: ['roomId'], handler: 'startGame' },
  { method: 'POST', pattern: /^\/api\/rooms\/([^/]+)\/answers$/, params: ['roomId'], handler: 'submitAnswer' },
  { method: 'POST', pattern: /^\/api\/rooms\/([^/]+)\/reconcile$/, params: ['roomId'], handler: 'reconcileRound' },
  { method: 'POST', pattern: /^\/api\/rooms\/([^/]+)\/advance$/, params: ['roomId'], handler: 'advanceRound' },
  { method: 'POST', pattern: /^\/api\/rooms\/([^/]+)\/players\/([^/]+)\/kick$/, params: ['roomId', 'playerId'], handler: 'kickPlayer' },
  { method: 'POST', pattern: /^\/api\/rooms\/([^/]+)\/leave$/, params: ['roomId'], handler: 'leaveRoom' },
  { method: 'POST', pattern: /^\/api\/rooms\/([^/]+)\/end$/, params: ['roomId'], handler: 'endRoom' },
  { method: 'POST', pattern: /^\/api\/rooms\/([^/]+)\/replay$/, params: ['roomId'], handler: 'replayGame' },
]

async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of request) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  return Buffer.concat(chunks).toString('utf8')
}

function writeResponse(response: ServerResponse, result: HttpResponseInit): void {
  response.statusCode = result.status ?? 200
  if (result.headers) {
    const headers = result.headers instanceof Headers
      ? result.headers.entries()
      : Object.entries(result.headers as unknown as Record<string, string | string[]>)
    for (const [name, value] of headers) response.setHeader(name, value)
  }
  if (result.jsonBody !== undefined) {
    response.setHeader('content-type', 'application/json; charset=utf-8')
    response.end(JSON.stringify(result.jsonBody))
  } else if (result.body !== undefined) {
    response.end(String(result.body))
  } else {
    response.end()
  }
}

const server = createServer(async (incoming, outgoing) => {
  const pathname = new URL(incoming.url ?? '/', 'http://localhost').pathname
  if (pathname === '/health') {
    outgoing.statusCode = 204
    outgoing.end()
    return
  }
  const route = routes.find((candidate) => candidate.method === incoming.method && candidate.pattern.test(pathname))
  if (!route) {
    outgoing.statusCode = 404
    outgoing.end('Not found')
    return
  }
  const match = route.pattern.exec(pathname)
  const params = Object.fromEntries(route.params.map((name, index) => [name, decodeURIComponent(match?.[index + 1] ?? '')]))
  const body = await readBody(incoming)
  const headers = new Headers()
  for (const [name, value] of Object.entries(incoming.headers)) {
    if (value !== undefined) headers.set(name, Array.isArray(value) ? value.join(', ') : value)
  }
  const request = { headers, params, text: async () => body } as unknown as HttpRequest
  const result = await handlers[route.handler](request, context)
  writeResponse(outgoing, result)
})

const port = Number(process.env.CHALLENGE_TEST_PORT ?? 7071)
server.listen(port, '127.0.0.1', () => console.log(`Challenge test adapter listening on http://127.0.0.1:${port}`))
