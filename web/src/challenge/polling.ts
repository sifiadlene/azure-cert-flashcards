import type { ChallengeCapability, SnapshotResponse } from './apiClient'
import type { RoomSnapshot } from './contracts'

export interface PollingCallbacks {
  onResult: (result: SnapshotResponse, requestStartedAtMs: number) => void
  onError: (error: unknown) => void
}

export interface PollingDependencies {
  fetchSnapshot: (capability: ChallengeCapability) => Promise<SnapshotResponse>
  setTimer?: typeof window.setTimeout
  clearTimer?: typeof window.clearTimeout
  random?: () => number
  now?: () => number
  isHidden?: () => boolean
}

const MAX_BACKOFF_MS = 16_000

export class ChallengePollingController {
  private readonly capability: ChallengeCapability
  private readonly callbacks: PollingCallbacks
  private readonly dependencies: PollingDependencies
  private timer: number | null = null
  private stopped = true
  private polling = false
  private refreshPending = false
  private failures = 0
  private snapshot: RoomSnapshot | null = null
  private readonly setTimer: typeof window.setTimeout
  private readonly clearTimer: typeof window.clearTimeout
  private readonly random: () => number
  private readonly now: () => number
  private readonly isHidden: () => boolean

  constructor(
    capability: ChallengeCapability,
    callbacks: PollingCallbacks,
    dependencies: PollingDependencies,
  ) {
    this.capability = capability
    this.callbacks = callbacks
    this.dependencies = dependencies
    this.setTimer = dependencies.setTimer ?? window.setTimeout.bind(window)
    this.clearTimer = dependencies.clearTimer ?? window.clearTimeout.bind(window)
    this.random = dependencies.random ?? Math.random
    this.now = dependencies.now ?? Date.now
    this.isHidden = dependencies.isHidden ?? (() => document.hidden)
  }

  start(snapshot?: RoomSnapshot): void {
    this.snapshot = snapshot ?? null
    this.stopped = false
    this.schedule(0)
  }

  refreshNow(): void {
    if (this.stopped) return
    if (this.polling) {
      this.refreshPending = true
      return
    }
    if (this.timer !== null) {
      this.clearTimer(this.timer)
      this.timer = null
    }
    this.schedule(0)
  }

  stop(): void {
    this.stopped = true
    if (this.timer !== null) this.clearTimer(this.timer)
    this.timer = null
  }

  private schedule(delayMs: number): void {
    if (this.stopped || this.timer !== null) return
    this.timer = this.setTimer(() => { void this.poll() }, delayMs) as unknown as number
  }

  private async poll(): Promise<void> {
    if (this.stopped || this.polling) return
    this.timer = null
    this.polling = true
    const requestStartedAtMs = this.now()
    try {
      const result = await this.dependencies.fetchSnapshot(this.capability)
      this.failures = 0
      this.snapshot = result.snapshot
      this.callbacks.onResult(result, requestStartedAtMs)
      this.polling = false
      if (this.stopped) return
      if (this.refreshPending) {
        this.refreshPending = false
        this.schedule(0)
        return
      }
      const base = this.snapshot?.polling.nextPollAfterMs
        ?? (this.snapshot?.phase.kind === 'lobby' ? 2_000 : 1_000)
      const hiddenMultiplier = this.isHidden() ? 4 : 1
      this.schedule(this.jitter(base * hiddenMultiplier))
    } catch (error) {
      this.polling = false
      this.refreshPending = false
      if (this.stopped) return
      this.failures += 1
      this.callbacks.onError(error)
      const backoff = Math.min(MAX_BACKOFF_MS, 1_000 * 2 ** (this.failures - 1))
      this.schedule(this.jitter(backoff))
    }
  }

  private jitter(value: number): number {
    return Math.round(value * (0.9 + this.random() * 0.2))
  }
}
