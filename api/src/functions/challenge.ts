import { app, type HttpHandler } from '@azure/functions'
import { getChallengeService } from '../application/composition'
import { createChallengeHandlers } from '../http/handlers'

function handler(name: keyof ReturnType<typeof createChallengeHandlers>): HttpHandler {
  return (request, context) => createChallengeHandlers(getChallengeService())[name](request, context)
}

app.http('challenge-create-room', {
  methods: ['POST'], authLevel: 'anonymous', route: 'rooms', handler: handler('createRoom'),
})
app.http('challenge-join-room', {
  methods: ['POST'], authLevel: 'anonymous', route: 'rooms/{roomCode}/join', handler: handler('joinRoom'),
})
app.http('challenge-resume-player', {
  methods: ['POST'], authLevel: 'anonymous', route: 'rooms/{roomCode}/resume', handler: handler('resumePlayer'),
})
app.http('challenge-get-snapshot', {
  methods: ['GET'], authLevel: 'anonymous', route: 'rooms/{roomId}', handler: handler('getSnapshot'),
})
app.http('challenge-start-game', {
  methods: ['POST'], authLevel: 'anonymous', route: 'rooms/{roomId}/start', handler: handler('startGame'),
})
app.http('challenge-submit-answer', {
  methods: ['POST'], authLevel: 'anonymous', route: 'rooms/{roomId}/answers', handler: handler('submitAnswer'),
})
app.http('challenge-reconcile-round', {
  methods: ['POST'], authLevel: 'anonymous', route: 'rooms/{roomId}/reconcile', handler: handler('reconcileRound'),
})
app.http('challenge-advance-round', {
  methods: ['POST'], authLevel: 'anonymous', route: 'rooms/{roomId}/advance', handler: handler('advanceRound'),
})
app.http('challenge-kick-player', {
  methods: ['POST'], authLevel: 'anonymous', route: 'rooms/{roomId}/players/{playerId}/kick', handler: handler('kickPlayer'),
})
app.http('challenge-leave-room', {
  methods: ['POST'], authLevel: 'anonymous', route: 'rooms/{roomId}/leave', handler: handler('leaveRoom'),
})
app.http('challenge-end-room', {
  methods: ['POST'], authLevel: 'anonymous', route: 'rooms/{roomId}/end', handler: handler('endRoom'),
})
app.http('challenge-replay-game', {
  methods: ['POST'], authLevel: 'anonymous', route: 'rooms/{roomId}/replay', handler: handler('replayGame'),
})
