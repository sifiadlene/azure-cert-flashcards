import { describe, expect, it } from 'vitest'
import { estimateServerClock, remainingSeconds, serverNow, unsynchronizedServerClock } from './serverClock'

describe('server clock', () => {
  it('estimates offset at the request midpoint and smooths later samples', () => {
    const first = estimateServerClock(unsynchronizedServerClock, 1_000, 1_200, 1_600)
    expect(first.offsetMs).toBe(500)
    const second = estimateServerClock(first, 2_000, 2_200, 2_400)
    expect(second.offsetMs).toBe(450)
    expect(serverNow(second, 3_000)).toBe(3_450)
  })

  it('rounds the countdown up without becoming negative', () => {
    const clock = { offsetMs: 500, synchronized: true }
    expect(remainingSeconds(5_001, clock, 3_501)).toBe(1)
    expect(remainingSeconds(4_000, clock, 4_000)).toBe(0)
  })
})
