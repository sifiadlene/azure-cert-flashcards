import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { DeckManifest, ExamDeck, QuestionRecord } from '../types'
import { ChallengeApiClient, ChallengeApiError, type ChallengeCapability } from './apiClient'
import { clearChallengeCapability, readChallengeCapability, writeChallengeCapability } from './capability'
import type { ChallengeError, ChallengeOptionKey, RoomSnapshot } from './contracts'
import { estimateServerClock, remainingSeconds, serverNow } from './serverClock'
import { ChallengePollingController } from './polling'
import { challengeReducer, commandsAreSafe, initialChallengeState } from './state'
import {
  ChallengeLobbyView,
  ChallengeQuestionView,
  ChallengeResultsView,
  ChallengeRevealView,
  ChallengeStartView,
  type HostSetupValue,
} from './ChallengeViews'
import { settingsFromHost } from './viewModel'

interface ChallengeFeatureProps {
  manifest: DeckManifest
  language: 'en' | 'fr'
  prefilledCode: string
  onExitToSolo: () => void
}

const defaultHost: HostSetupValue = {
  nickname: '',
  examSlug: '',
  domain: 'all',
  questionCount: 5,
  timerSeconds: 30,
}

function internalError(): ChallengeError {
  return { kind: 'internal', traceId: 'client-network', retryable: true }
}

function errorFrom(value: unknown): ChallengeError {
  return value instanceof ChallengeApiError ? value.detail : internalError()
}

function errorTranslationKey(error: ChallengeError): string {
  switch (error.kind) {
    case 'roomNotFound': return 'challenge.errors.roomNotFound'
    case 'roomFull': return 'challenge.errors.roomFull'
    case 'nicknameUnavailable': return 'challenge.errors.nicknameUnavailable'
    case 'versionConflict': return 'challenge.errors.staleVersion'
    case 'answerTooLate': return 'challenge.errors.answerTooLate'
    case 'deckVersionMismatch': return 'challenge.errors.deckMismatch'
    case 'roomExpired': return 'challenge.errors.roomExpired'
    case 'unauthorized': return 'challenge.errors.kicked'
    case 'rateLimited': return 'challenge.errors.rateLimited'
    case 'forbidden': return 'challenge.errors.forbidden'
    case 'phaseConflict': return 'challenge.errors.phaseConflict'
    case 'duplicateAnswer': return 'challenge.errors.duplicateAnswer'
    case 'unsupportedPool': return 'challenge.errors.unsupportedPool'
    case 'validation': return 'challenge.errors.validation'
    case 'internal': return 'challenge.errors.apiUnavailable'
  }
}

function isTerminalCredentialError(error: ChallengeError): boolean {
  return error.kind === 'unauthorized' || error.kind === 'roomExpired' || error.kind === 'roomNotFound'
}

async function loadLocalizedDeck(examSlug: string, language: 'en' | 'fr'): Promise<ExamDeck> {
  const candidates = language === 'fr' ? [`${examSlug}-fr.json`, `${examSlug}.json`] : [`${examSlug}.json`]
  for (const fileName of candidates) {
    const response = await fetch(`${import.meta.env.BASE_URL}data/decks/${fileName}`)
    if (response.ok) return response.json() as Promise<ExamDeck>
  }
  throw new Error('deck-unavailable')
}

export function ChallengeFeature({ manifest, language, prefilledCode, onExitToSolo }: ChallengeFeatureProps) {
  const { t } = useTranslation()
  const api = useMemo(() => new ChallengeApiClient(), [])
  const [state, dispatch] = useReducer(challengeReducer, initialChallengeState)
  const [host, setHost] = useState(defaultHost)
  const [hostDeck, setHostDeck] = useState<ExamDeck | null>(null)
  const [roomDeck, setRoomDeck] = useState<ExamDeck | null>(null)
  const [joinCode, setJoinCode] = useState(prefilledCode)
  const [joinNickname, setJoinNickname] = useState('')
  const [entryBusy, setEntryBusy] = useState(false)
  const [deckError, setDeckError] = useState(false)
  const [copied, setCopied] = useState(false)
  const [tick, setTick] = useState(Date.now())
  const pollerRef = useRef<ChallengePollingController | null>(null)

  useEffect(() => {
    const saved = readChallengeCapability()
    if (saved && (!prefilledCode || saved.roomCode === prefilledCode)) {
      dispatch({ type: 'connect', capability: saved })
    }
  }, [prefilledCode])

  useEffect(() => {
    if (!state.capability) return
    const poller = new ChallengePollingController(
      state.capability,
      {
        onResult: (result, startedAtMs) => {
          const clock = estimateServerClock(state.clock, startedAtMs, result.receivedAtMs, result.snapshot.polling.serverNowMs)
          dispatch({ type: 'snapshot', snapshot: result.snapshot, clock })
        },
        onError: (error) => {
          const detail = errorFrom(error)
          if (isTerminalCredentialError(detail)) {
            clearChallengeCapability()
            poller.stop()
            dispatch({ type: 'terminalFailure', error: detail })
            return
          }
          dispatch({ type: 'pollFailed', error: detail })
        },
      },
      { fetchSnapshot: (capability) => api.getSnapshot(capability) },
    )
    pollerRef.current = poller
    poller.start(state.snapshot ?? undefined)
    return () => {
      poller.stop()
      if (pollerRef.current === poller) pollerRef.current = null
    }
    // The controller owns the serialized polling loop; restarting it on every render would create overlapping requests.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, state.capability])

  useEffect(() => {
    const timer = window.setInterval(() => setTick(Date.now()), 500)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    if (!host.examSlug) {
      setHostDeck(null)
      return
    }
    let active = true
    void loadLocalizedDeck(host.examSlug, language).then((deck) => {
      if (active) setHostDeck(deck)
    }).catch(() => {
      if (active) setHostDeck(null)
    })
    return () => { active = false }
  }, [host.examSlug, language])

  useEffect(() => {
    const settings = state.snapshot?.settings
    if (!settings) {
      setRoomDeck(null)
      return
    }
    let active = true
    setDeckError(false)
    void loadLocalizedDeck(settings.examSlug, language).then((deck) => {
      if (!active) return
      if (deck.exam.deckVersion !== settings.deckVersion) {
        setDeckError(true)
        setRoomDeck(null)
      } else {
        setRoomDeck(deck)
      }
    }).catch(() => {
      if (active) {
        setDeckError(true)
        setRoomDeck(null)
      }
    })
    return () => { active = false }
  }, [state.snapshot?.settings, language])

  const acceptTokenResponse = useCallback((response: { snapshot: RoomSnapshot; token: string; playerId: string }) => {
    const player = response.snapshot.players.find((candidate) => candidate.playerId === response.playerId)
    const capability: ChallengeCapability = {
      roomId: response.snapshot.roomId,
      roomCode: response.snapshot.roomCode,
      playerId: response.playerId,
      role: player?.role ?? 'player',
      token: response.token,
    }
    writeChallengeCapability(capability)
    dispatch({ type: 'connect', capability })
    dispatch({
      type: 'snapshot',
      snapshot: response.snapshot,
      clock: { offsetMs: response.snapshot.polling.serverNowMs - Date.now(), synchronized: true },
    })
  }, [])

  async function createRoom() {
    if (!hostDeck) return
    setEntryBusy(true)
    try {
      acceptTokenResponse(await api.createRoom(host.nickname, settingsFromHost(host, hostDeck)))
    } catch (error) {
      dispatch({ type: 'commandFailed', error: errorFrom(error) })
    } finally {
      setEntryBusy(false)
    }
  }

  async function joinRoom() {
    setEntryBusy(true)
    try {
      acceptTokenResponse(await api.joinRoom(joinCode, joinNickname))
    } catch (error) {
      dispatch({ type: 'commandFailed', error: errorFrom(error) })
    } finally {
      setEntryBusy(false)
    }
  }

  async function runCommand(command: (roomVersion: number) => Promise<{ snapshot: RoomSnapshot }>): Promise<void> {
    if (!snapshot || !capability) return
    dispatch({ type: 'commandStarted' })
    try {
      let response: { snapshot: RoomSnapshot }
      try {
        response = await command(snapshot.polling.roomVersion)
      } catch (error) {
        const detail = errorFrom(error)
        if (detail.kind !== 'versionConflict') throw error
        const refreshed = await api.getSnapshot(capability)
        dispatch({
          type: 'snapshot',
          snapshot: refreshed.snapshot,
          clock: { offsetMs: refreshed.snapshot.polling.serverNowMs - Date.now(), synchronized: true },
        })
        response = await command(refreshed.snapshot.polling.roomVersion)
      }
      dispatch({
        type: 'snapshot',
        snapshot: response.snapshot,
        clock: { offsetMs: response.snapshot.polling.serverNowMs - Date.now(), synchronized: true },
      })
      pollerRef.current?.refreshNow()
    } catch (error) {
      const detail = errorFrom(error)
      dispatch({ type: 'commandFailed', error: detail })
      if (detail.kind === 'versionConflict') pollerRef.current?.refreshNow()
    }
  }

  const capability = state.capability
  const snapshot = state.snapshot
  const safe = commandsAreSafe(state) && !deckError
  const phase = snapshot?.phase
  const remaining = phase?.kind === 'questionOpen' ? remainingSeconds(phase.deadlineAtMs, state.clock, tick) : 0
  const advanceIn = phase?.kind === 'questionReveal'
    ? Math.max(0, Math.ceil((phase.advanceAtMs - serverNow(state.clock, tick)) / 1_000))
    : 0

  useEffect(() => {
    if (!capability || !snapshot || !safe || phase?.kind !== 'questionOpen' || remaining > 0) return
    void runCommand((version) => api.reconcile(capability, version, phase.roundIndex))
    // `safe` becomes false synchronously once the command starts, preventing duplicate reconciliation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remaining, phase?.kind, safe])

  const currentQuestion: QuestionRecord | null = useMemo(() => {
    if (!roomDeck || !phase || (phase.kind !== 'questionOpen' && phase.kind !== 'questionReveal')) return null
    const questionId = phase.kind === 'questionOpen' ? phase.question.id : phase.reveal.question.id
    return roomDeck.questions.find((question) => question.id === questionId) ?? null
  }, [roomDeck, phase])

  useEffect(() => {
    if (phase && (phase.kind === 'questionOpen' || phase.kind === 'questionReveal') && roomDeck && !currentQuestion) {
      setDeckError(true)
    }
  }, [phase, roomDeck, currentQuestion])

  function clearRoom(exitToSolo = false) {
    clearChallengeCapability()
    pollerRef.current?.stop()
    dispatch({ type: 'reset' })
    setRoomDeck(null)
    if (exitToSolo) onExitToSolo()
  }

  async function exitRoom() {
    if (capability && snapshot && safe) {
      await runCommand((version) => api.leave(capability, version))
    }
    clearRoom(true)
  }

  async function copyLink() {
    if (!snapshot) return
    const url = `${window.location.origin}${window.location.pathname}?challenge=${encodeURIComponent(snapshot.roomCode)}`
    await navigator.clipboard.writeText(url)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 2_000)
  }

  const shareUrl = snapshot
    ? `${window.location.origin}${window.location.pathname}?challenge=${encodeURIComponent(snapshot.roomCode)}`
    : ''
  const shared = capability && snapshot ? {
    t,
    capability,
    snapshot,
    safe,
    shareUrl,
    onCopy: () => { void copyLink() },
    onExit: () => { void exitRoom() },
    onKick: (playerId: string) => { void runCommand((version) => api.kick(capability, version, playerId)) },
  } : null
  const hostPlayer = snapshot?.players.find((player) => player.role === 'host')

  return <div className="challenge-feature">
    <div className="challenge-feature-header">
      <div><p className="section-label">{t('challenge.liveLabel')}</p><h2>{t('challenge.title')}</h2></div>
      {!snapshot && <button type="button" className="back-link" onClick={onExitToSolo}>← {t('challenge.soloPractice')}</button>}
    </div>

    {state.connection === 'reconnecting' && snapshot && <div className="alert warning" role="status">{t('challenge.reconnecting')}</div>}
    {state.connection === 'connecting' && !snapshot && <div className="loading-state card" role="status">{t('challenge.reconnecting')}</div>}
    {hostPlayer?.presence === 'inactive' && capability?.role !== 'host' && <div className="alert warning" role="status">{t('challenge.hostInactive')}</div>}
    {copied && <div className="sr-only" role="status">{t('challenge.linkCopied')}</div>}
    {(state.error || deckError) && <div className="alert error" role="alert">{deckError ? t('challenge.errors.deckMismatch') : t(errorTranslationKey(state.error as ChallengeError))}</div>}

    {!capability && state.connection !== 'connecting' && <ChallengeStartView
      t={t}
      manifest={manifest}
      prefilledCode={prefilledCode}
      deck={hostDeck}
      host={host}
      joinCode={joinCode}
      joinNickname={joinNickname}
      busy={entryBusy}
      onHostChange={setHost}
      onExamChange={(examSlug) => setHost({ ...host, examSlug, domain: 'all', questionCount: 5 })}
      onJoinCodeChange={setJoinCode}
      onJoinNicknameChange={setJoinNickname}
      onCreate={() => { void createRoom() }}
      onJoin={() => { void joinRoom() }}
    />}

    {shared && phase?.kind === 'lobby' && <ChallengeLobbyView {...shared} onStart={() => { void runCommand((version) => api.start(shared.capability, version)) }} />}
    {shared && phase?.kind === 'questionOpen' && currentQuestion && <ChallengeQuestionView
      {...shared}
      question={currentQuestion}
      selectedOption={state.selectedOption}
      remaining={remaining}
      onSelect={(option: ChallengeOptionKey) => dispatch({ type: 'selectOption', option })}
      onSubmit={() => {
        if (state.selectedOption) void runCommand((version) => api.submitAnswer(shared.capability, version, phase.roundIndex, state.selectedOption as ChallengeOptionKey))
      }}
    />}
    {shared && phase?.kind === 'questionReveal' && currentQuestion && <ChallengeRevealView {...shared} question={currentQuestion} advanceIn={advanceIn} onAdvance={() => { void runCommand((version) => api.advance(shared.capability, version)) }} />}
    {shared && phase?.kind === 'completed' && <ChallengeResultsView {...shared} onReplay={() => { void runCommand((version) => api.replay(shared.capability, version)) }} />}
    {shared && phase?.kind === 'expired' && <div className="card"><h2>{t('challenge.errors.roomExpired')}</h2><button type="button" className="btn-primary" onClick={() => clearRoom(true)}>{t('challenge.soloPractice')}</button></div>}
  </div>
}
