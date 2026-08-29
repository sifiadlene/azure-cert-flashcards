import type { TFunction } from 'i18next'
import type { ChallengeCapability } from './apiClient'
import {
  CHALLENGE_QUESTION_COUNTS,
  CHALLENGE_TIMER_SECONDS,
  type ChallengeOptionKey,
  type ChallengeQuestionCount,
  type ChallengeTimerSeconds,
  type RoomSnapshot,
} from './contracts'
import type { ExamDeck, DeckManifest, QuestionRecord } from '../types'
import { sanitizeChallengeHtml } from './sanitize'

export interface HostSetupValue {
  nickname: string
  examSlug: string
  domain: string
  questionCount: ChallengeQuestionCount
  timerSeconds: ChallengeTimerSeconds
}

interface StartProps {
  t: TFunction
  manifest: DeckManifest
  prefilledCode: string
  deck: ExamDeck | null
  host: HostSetupValue
  joinCode: string
  joinNickname: string
  busy: boolean
  onHostChange: (value: HostSetupValue) => void
  onExamChange: (examSlug: string) => void
  onJoinCodeChange: (value: string) => void
  onJoinNicknameChange: (value: string) => void
  onCreate: () => void
  onJoin: () => void
}

export function ChallengeStartView(props: StartProps) {
  const { t, manifest, host, deck } = props
  const scopedCount = deck
    ? deck.questions.filter((question) => host.domain === 'all' || question.domain === host.domain).length
    : 0

  return (
    <div className="challenge-entry-grid">
      <section className="card challenge-entry-card" aria-labelledby="host-challenge-title">
        <p className="section-label">{t('challenge.entry.eyebrow')}</p>
        <h2 id="host-challenge-title" className="card-title">{t('challenge.entry.hostTitle')}</h2>
        <p className="challenge-muted">{t('challenge.entry.hostDescription')}</p>
        <div className="field">
          <label htmlFor="challenge-host-name">{t('challenge.nickname')}</label>
          <input id="challenge-host-name" value={host.nickname} maxLength={24} autoComplete="nickname" onChange={(event) => props.onHostChange({ ...host, nickname: event.target.value })} />
        </div>
        <div className="field">
          <label htmlFor="challenge-exam">{t('setup.examLabel')}</label>
          <select id="challenge-exam" value={host.examSlug} onChange={(event) => props.onExamChange(event.target.value)}>
            <option value="">{t('setup.examPlaceholder')}</option>
            {manifest.exams.map((exam) => <option key={exam.slug} value={exam.slug}>{exam.code} — {exam.title}</option>)}
          </select>
        </div>
        {deck && <>
          <div className="field">
            <label htmlFor="challenge-domain">{t('setup.domainLabel')}</label>
            <select id="challenge-domain" value={host.domain} onChange={(event) => props.onHostChange({ ...host, domain: event.target.value })}>
              <option value="all">{t('setup.domainAll')}</option>
              {deck.exam.domains.map((domain) => <option key={domain} value={domain}>{t(`taxonomy.domains.${domain}`, { defaultValue: domain })}</option>)}
            </select>
          </div>
          <fieldset className="challenge-choice-group">
            <legend>{t('challenge.setup.questionCount')}</legend>
            <div className="challenge-choice-row">
              {CHALLENGE_QUESTION_COUNTS.map((count) => <button key={count} type="button" className={host.questionCount === count ? 'choice-chip active' : 'choice-chip'} aria-pressed={host.questionCount === count} disabled={scopedCount < count} onClick={() => props.onHostChange({ ...host, questionCount: count })}>{count}</button>)}
            </div>
            <small>{t('challenge.setup.available', { count: scopedCount })}</small>
          </fieldset>
          <fieldset className="challenge-choice-group">
            <legend>{t('challenge.setup.timer')}</legend>
            <div className="challenge-choice-row">
              {CHALLENGE_TIMER_SECONDS.map((seconds) => <button key={seconds} type="button" className={host.timerSeconds === seconds ? 'choice-chip active' : 'choice-chip'} aria-pressed={host.timerSeconds === seconds} onClick={() => props.onHostChange({ ...host, timerSeconds: seconds })}>{t('challenge.seconds', { count: seconds })}</button>)}
            </div>
          </fieldset>
        </>}
        <button type="button" className="btn-primary challenge-wide-action" disabled={props.busy || !deck || host.nickname.trim().length < 2 || scopedCount < host.questionCount} onClick={props.onCreate}>
          {props.busy ? t('challenge.working') : t('challenge.entry.hostAction')}
        </button>
      </section>

      <section className="card challenge-entry-card" aria-labelledby="join-challenge-title">
        <p className="section-label">{t('challenge.entry.invited')}</p>
        <h2 id="join-challenge-title" className="card-title">{t('challenge.entry.joinTitle')}</h2>
        <p className="challenge-muted">{t('challenge.entry.joinDescription')}</p>
        <div className="field">
          <label htmlFor="challenge-room-code">{t('challenge.roomCode')}</label>
          <input id="challenge-room-code" className="room-code-input" value={props.joinCode} maxLength={6} autoComplete="off" onChange={(event) => props.onJoinCodeChange(event.target.value.toUpperCase())} />
        </div>
        <div className="field">
          <label htmlFor="challenge-join-name">{t('challenge.nickname')}</label>
          <input id="challenge-join-name" value={props.joinNickname} maxLength={24} autoComplete="nickname" onChange={(event) => props.onJoinNicknameChange(event.target.value)} />
        </div>
        {props.prefilledCode && <p className="prefill-note">{t('challenge.entry.prefilled')}</p>}
        <button type="button" className="btn-primary challenge-wide-action" disabled={props.busy || props.joinCode.length !== 6 || props.joinNickname.trim().length < 2} onClick={props.onJoin}>
          {props.busy ? t('challenge.working') : t('challenge.entry.joinAction')}
        </button>
      </section>
    </div>
  )
}

interface SharedRoomProps {
  t: TFunction
  snapshot: RoomSnapshot
  capability: ChallengeCapability
  safe: boolean
  shareUrl: string
  onCopy: () => void
  onExit: () => void
  onKick: (playerId: string) => void
}

function RoomHeader({ t, snapshot, shareUrl, onCopy }: Pick<SharedRoomProps, 't' | 'snapshot' | 'shareUrl' | 'onCopy'>) {
  return <div className="room-identity">
    <div><span className="section-label">{t('challenge.roomCode')}</span><strong className="room-code">{snapshot.roomCode}</strong></div>
    <button type="button" className="btn-secondary" onClick={onCopy} data-share-url={shareUrl}>{t('challenge.copyLink')}</button>
  </div>
}

function PlayerRoster({ t, snapshot, capability, safe, onKick }: Pick<SharedRoomProps, 't' | 'snapshot' | 'capability' | 'safe' | 'onKick'>) {
  const canKick = capability.role === 'host' && (snapshot.phase.kind === 'lobby' || snapshot.phase.kind === 'questionReveal')
  return <section className="challenge-panel" aria-labelledby="roster-title">
    <div className="panel-heading"><h3 id="roster-title">{t('challenge.roster')}</h3><span className="badge">{snapshot.players.length}/10</span></div>
    <ul className="roster-list">
      {snapshot.players.map((player) => <li key={player.playerId}>
        <span className={`presence-dot ${player.presence}`} aria-hidden="true" />
        <span><strong>{player.nickname}</strong>{player.playerId === capability.playerId && <span className="you-label"> {t('challenge.you')}</span>}</span>
        {player.role === 'host' && <span className="badge primary">{t('challenge.host')}</span>}
        <span className="presence-label">{t(`challenge.presence.${player.presence}`)}</span>
        {canKick && player.role !== 'host' && <button type="button" className="icon-action" aria-label={t('challenge.kickPlayer', { name: player.nickname })} disabled={!safe} onClick={() => onKick(player.playerId)}>×</button>}
      </li>)}
    </ul>
  </section>
}

export function ChallengeLobbyView(props: SharedRoomProps & { onStart: () => void }) {
  const { t, snapshot, capability, safe } = props
  const settings = snapshot.settings
  return <div className="challenge-layout">
    <main className="card challenge-main-card">
      <RoomHeader {...props} />
      <div className="lobby-hero"><span className="lobby-orbit" aria-hidden="true" /><p className="section-label">{t('challenge.lobby.status')}</p><h2>{t('challenge.lobby.title')}</h2><p>{t('challenge.lobby.description')}</p></div>
      <dl className="challenge-settings-summary">
        <div><dt>{t('setup.examLabel')}</dt><dd>{settings.examSlug.toUpperCase()}</dd></div>
        <div><dt>{t('setup.domainLabel')}</dt><dd>{settings.scope.kind === 'all' ? t('setup.domainAll') : t(`taxonomy.domains.${settings.scope.domain}`, { defaultValue: settings.scope.domain })}</dd></div>
        <div><dt>{t('challenge.setup.questionCount')}</dt><dd>{settings.questionCount}</dd></div>
        <div><dt>{t('challenge.setup.timer')}</dt><dd>{t('challenge.seconds', { count: settings.timerSeconds })}</dd></div>
      </dl>
      {capability.role === 'host'
        ? <button type="button" className="btn-primary challenge-wide-action" disabled={!safe || snapshot.players.length < 2} onClick={props.onStart}>{snapshot.players.length < 2 ? t('challenge.lobby.waitingForPlayer') : t('challenge.lobby.start')}</button>
        : <p className="waiting-note" role="status">{t('challenge.lobby.waitingForHost')}</p>}
      <button type="button" className="back-link" disabled={!safe} onClick={props.onExit}>{t('challenge.exit')}</button>
    </main>
    <aside><PlayerRoster {...props} /></aside>
  </div>
}

function Leaderboard({ t, snapshot, capability }: Pick<SharedRoomProps, 't' | 'snapshot' | 'capability'>) {
  return <section className="challenge-panel leaderboard" aria-labelledby="leaderboard-title">
    <div className="panel-heading"><h3 id="leaderboard-title">{t('challenge.leaderboard')}</h3></div>
    <ol>
      {snapshot.leaderboard.map((row) => <li key={row.playerId} className={row.playerId === capability.playerId ? 'is-you' : ''}>
        <span className="rank">#{row.rank}</span><span>{row.nickname}</span><strong>{t('challenge.points', { count: row.points })}</strong>
      </li>)}
    </ol>
  </section>
}

export function ChallengeQuestionView(props: SharedRoomProps & {
  question: QuestionRecord
  selectedOption: ChallengeOptionKey | null
  remaining: number
  onSelect: (option: ChallengeOptionKey) => void
  onSubmit: () => void
}) {
  const { t, snapshot, question, selectedOption, remaining } = props
  if (snapshot.phase.kind !== 'questionOpen') return null
  const openSnapshot = snapshot as Extract<RoomSnapshot, { viewerAnswer: unknown }>
  const submitted = openSnapshot.viewerAnswer.kind === 'submitted'
  return <div className="challenge-layout game-layout">
    <main className="card challenge-main-card">
      <div className="game-status"><span>{t('challenge.game.questionOf', { current: snapshot.phase.roundIndex + 1, total: snapshot.roundCount })}</span><strong className={remaining <= 5 ? 'countdown urgent' : 'countdown'} aria-label={t('challenge.game.timeRemaining', { count: remaining })}>{remaining}</strong></div>
      <div className="progress-bar" role="progressbar" aria-label={t('challenge.game.progress')} aria-valuemin={1} aria-valuemax={snapshot.roundCount} aria-valuenow={snapshot.phase.roundIndex + 1}><span style={{ width: `${((snapshot.phase.roundIndex + 1) / snapshot.roundCount) * 100}%` }} /></div>
      <div className="question-meta" data-question-id={question.id}><span className="badge">{t(`taxonomy.domains.${question.domain}`, { defaultValue: question.domain })}</span></div>
      <h2 className="sr-only">{t('challenge.game.questionHeading')}</h2>
      <div className="question-prompt" dangerouslySetInnerHTML={{ __html: sanitizeChallengeHtml(question.promptHtml) }} />
      <ul className="option-list">
        {question.options.map((option) => <li key={option.key}><button type="button" className={`option-card ${selectedOption === option.key || (openSnapshot.viewerAnswer.kind === 'submitted' && openSnapshot.viewerAnswer.selectedOption === option.key) ? 'selected' : ''}`} disabled={submitted || !props.safe} aria-pressed={selectedOption === option.key} onClick={() => props.onSelect(option.key)}><span className="option-key">{option.key}</span><span dangerouslySetInnerHTML={{ __html: sanitizeChallengeHtml(option.label) }} /></button></li>)}
      </ul>
      {submitted
        ? <p className="waiting-note" role="status">{t('challenge.game.answerLocked')}</p>
        : <button type="button" className="btn-primary challenge-wide-action" disabled={!props.safe || !selectedOption} onClick={props.onSubmit}>{t('challenge.game.submit')}</button>}
      <p className="answered-status">{t('challenge.game.answeredCount', { answered: openSnapshot.answeredPlayerCount, total: snapshot.players.length })}</p>
    </main>
    <aside><Leaderboard {...props} /><PlayerRoster {...props} /></aside>
  </div>
}

export function ChallengeRevealView(props: SharedRoomProps & { question: QuestionRecord; advanceIn: number; onAdvance: () => void }) {
  const { t, snapshot, question, capability } = props
  if (snapshot.phase.kind !== 'questionReveal') return null
  const revealPhase = snapshot.phase as Extract<RoomSnapshot['phase'], { kind: 'questionReveal' }>
  const result = revealPhase.reveal.results.find((row) => row.playerId === capability.playerId)
  const correct = question.options.find((option) => option.key === revealPhase.reveal.correctOption)
  return <div className="challenge-layout game-layout">
    <main className="card challenge-main-card">
      <p className="section-label">{t('challenge.reveal.roundComplete')}</p>
      <h2>{result?.outcome === 'correct' ? t('challenge.reveal.correct') : t('challenge.reveal.notCorrect')}</h2>
      <div className="answer-reveal challenge-reveal">
        <h3>{t('challenge.reveal.answer', { option: revealPhase.reveal.correctOption, label: correct?.label ?? '' })}</h3>
        {question.rationaleHtml && <div className="rationale-text" dangerouslySetInnerHTML={{ __html: sanitizeChallengeHtml(question.rationaleHtml) }} />}
      </div>
      <div className="round-points"><strong>{result ? `+${result.pointsAwarded}` : '+0'}</strong><span>{t('challenge.reveal.thisRound')}</span></div>
      <ul className="round-results" aria-label={t('challenge.reveal.playerResults')}>
        {revealPhase.reveal.results.map((row) => {
          const player = snapshot.players.find((candidate) => candidate.playerId === row.playerId)
          return <li key={row.playerId}><span>{player?.nickname}</span><span>{t(`challenge.outcome.${row.outcome}`)}</span><strong>+{row.pointsAwarded}</strong></li>
        })}
      </ul>
      {capability.role === 'host'
        ? <button type="button" className="btn-primary challenge-wide-action" disabled={!props.safe} onClick={props.onAdvance}>{snapshot.phase.roundIndex + 1 === snapshot.roundCount ? t('challenge.reveal.results') : t('challenge.reveal.nextNow')}</button>
        : <p className="waiting-note" role="status">{t('challenge.reveal.nextIn', { count: props.advanceIn })}</p>}
    </main>
    <aside><Leaderboard {...props} /><PlayerRoster {...props} /></aside>
  </div>
}

export function ChallengeResultsView(props: SharedRoomProps & { onReplay: () => void }) {
  const { t, snapshot, capability } = props
  const row = snapshot.leaderboard.find((candidate) => candidate.playerId === capability.playerId)
  return <div className="challenge-layout">
    <main className="card challenge-main-card results-challenge">
      <p className="section-label">{t('challenge.results.complete')}</p>
      <h2>{t('challenge.results.title')}</h2>
      <div className="placement"><span>{t('challenge.results.placement')}</span><strong>#{row?.rank ?? '—'}</strong></div>
      <dl className="challenge-settings-summary"><div><dt>{t('challenge.results.points')}</dt><dd>{row?.points ?? 0}</dd></div><div><dt>{t('challenge.results.correct')}</dt><dd>{row?.correctCount ?? 0}/{snapshot.roundCount}</dd></div><div><dt>{t('challenge.results.responseTime')}</dt><dd>{Math.round((row?.cumulativeResponseTimeMs ?? 0) / 100) / 10}s</dd></div></dl>
      <Leaderboard {...props} />
      <div className="results-actions">{capability.role === 'host' && <button type="button" className="btn-primary" disabled={!props.safe} onClick={props.onReplay}>{t('challenge.results.replay')}</button>}<button type="button" className="btn-secondary" disabled={!props.safe} onClick={props.onExit}>{t('challenge.exit')}</button></div>
    </main>
    <aside><PlayerRoster {...props} /></aside>
  </div>
}

