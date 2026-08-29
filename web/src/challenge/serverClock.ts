export interface ServerClock {
  offsetMs: number
  synchronized: boolean
}

export const unsynchronizedServerClock: ServerClock = { offsetMs: 0, synchronized: false }

export function estimateServerClock(
  current: ServerClock,
  requestStartedAtMs: number,
  responseReceivedAtMs: number,
  serverNowMs: number,
): ServerClock {
  const midpoint = requestStartedAtMs + (responseReceivedAtMs - requestStartedAtMs) / 2
  const sample = serverNowMs - midpoint
  return {
    offsetMs: current.synchronized ? current.offsetMs * 0.75 + sample * 0.25 : sample,
    synchronized: true,
  }
}

export function serverNow(clock: ServerClock, clientNowMs = Date.now()): number {
  return clientNowMs + clock.offsetMs
}

export function remainingSeconds(deadlineAtMs: number, clock: ServerClock, clientNowMs = Date.now()): number {
  return Math.max(0, Math.ceil((deadlineAtMs - serverNow(clock, clientNowMs)) / 1_000))
}
