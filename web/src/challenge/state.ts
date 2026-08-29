import type { ChallengeCapability } from './apiClient'
import type { ChallengeError, ChallengeOptionKey, RoomSnapshot } from './contracts'
import type { ServerClock } from './serverClock'
import { unsynchronizedServerClock } from './serverClock'

export type ConnectionState = 'idle' | 'connecting' | 'connected' | 'reconnecting'

export interface ChallengeState {
  capability: ChallengeCapability | null
  snapshot: RoomSnapshot | null
  connection: ConnectionState
  commandPending: boolean
  selectedOption: ChallengeOptionKey | null
  error: ChallengeError | null
  clock: ServerClock
}

export const initialChallengeState: ChallengeState = {
  capability: null,
  snapshot: null,
  connection: 'idle',
  commandPending: false,
  selectedOption: null,
  error: null,
  clock: unsynchronizedServerClock,
}

export type ChallengeAction =
  | { type: 'connect'; capability: ChallengeCapability }
  | { type: 'snapshot'; snapshot: RoomSnapshot; clock: ServerClock }
  | { type: 'pollFailed'; error: ChallengeError }
  | { type: 'terminalFailure'; error: ChallengeError }
  | { type: 'selectOption'; option: ChallengeOptionKey }
  | { type: 'commandStarted' }
  | { type: 'commandFailed'; error: ChallengeError }
  | { type: 'reset' }

export function challengeReducer(state: ChallengeState, action: ChallengeAction): ChallengeState {
  switch (action.type) {
    case 'connect':
      return { ...state, capability: action.capability, connection: 'connecting', error: null }
    case 'snapshot': {
      if (state.snapshot && action.snapshot.polling.roomVersion < state.snapshot.polling.roomVersion) {
        return { ...state, connection: 'connected', commandPending: false, clock: action.clock }
      }
      const roundChanged = state.snapshot?.phase.kind !== action.snapshot.phase.kind
        || ((state.snapshot?.phase.kind === 'questionOpen' || state.snapshot?.phase.kind === 'questionReveal')
          && (action.snapshot.phase.kind === 'questionOpen' || action.snapshot.phase.kind === 'questionReveal')
          && state.snapshot.phase.roundIndex !== action.snapshot.phase.roundIndex)
      return {
        ...state,
        snapshot: action.snapshot,
        connection: 'connected',
        commandPending: false,
        selectedOption: roundChanged ? null : state.selectedOption,
        error: null,
        clock: action.clock,
      }
    }
    case 'pollFailed':
      return { ...state, connection: 'reconnecting', error: action.error }
    case 'terminalFailure':
      return {
        ...initialChallengeState,
        error: action.error,
      }
    case 'selectOption':
      return { ...state, selectedOption: action.option }
    case 'commandStarted':
      return { ...state, commandPending: true, error: null }
    case 'commandFailed':
      return { ...state, commandPending: false, error: action.error }
    case 'reset':
      return initialChallengeState
  }
}

export function commandsAreSafe(state: ChallengeState): boolean {
  return state.connection === 'connected' && !state.commandPending && state.snapshot !== null
}
