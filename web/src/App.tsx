import { startTransition, useEffect, useState } from 'react'
import DOMPurify from 'dompurify'
import './App.css'
import type {
  DeckManifest,
  ExamDeck,
  ExamProgress,
  ProgressMap,
  PracticeMode,
  QuestionRecord,
} from './types'

interface StoredAnswer {
  selected: 'A' | 'B' | 'C'
  correct: boolean
}

interface SessionState {
  examSlug: string
  mode: PracticeMode
  questionIds: string[]
  questionIndex: number
  answers: Record<string, StoredAnswer>
  selectedOption: 'A' | 'B' | 'C' | null
  revealAnswer: boolean
  startedAt: number
}

interface SessionResult {
  examSlug: string
  mode: PracticeMode
  total: number
  correctCount: number
  missedIds: string[]
  elapsedSeconds: number
  completedAt: string
}

interface SetupState {
  mode: PracticeMode
  domain: string
  topic: string
  reviewMissed: boolean
}

const progressStorageKey = 'certification-flashcards-progress'

const defaultSetup: SetupState = {
  mode: 'practice',
  domain: 'all',
  topic: 'all',
  reviewMissed: false,
}

function getDataUrl(path: string) {
  return `${import.meta.env.BASE_URL}data/${path}`
}

function readProgress(): ProgressMap {
  const savedValue = window.localStorage.getItem(progressStorageKey)

  if (!savedValue) {
    return {}
  }

  try {
    return JSON.parse(savedValue) as ProgressMap
  } catch {
    return {}
  }
}

function writeProgress(progress: ProgressMap) {
  window.localStorage.setItem(progressStorageKey, JSON.stringify(progress))
}

function stripHtml(html: string) {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
}

function buildExcerpt(html: string, maxLength = 120) {
  const text = stripHtml(html)

  if (text.length <= maxLength) {
    return text
  }

  return `${text.slice(0, maxLength).trimEnd()}...`
}

function sanitizeHtml(html: string) {
  const sanitized = DOMPurify.sanitize(html, {
    ALLOWED_TAGS: ['a', 'br', 'code', 'em', 'strong'],
    ALLOWED_ATTR: ['href', 'rel', 'target'],
  })

  return sanitized.replace(/<a\s/gi, '<a target="_blank" rel="noreferrer" ')
}

function formatDate(isoString?: string) {
  if (!isoString) {
    return 'N/A'
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(isoString))
}

function formatElapsedTime(totalSeconds: number) {
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60

  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

function getProgressLabel(progress?: ExamProgress) {
  if (!progress?.lastTotal || progress.lastScore === undefined) {
    return 'No attempts yet'
  }

  const score = Math.round((progress.lastScore / progress.lastTotal) * 100)

  return `${progress.lastScore}/${progress.lastTotal} (${score}%)`
}

function filterQuestions(
  questions: QuestionRecord[],
  setup: SetupState,
  missedIds: string[],
) {
  return questions.filter((question) => {
    if (setup.domain !== 'all' && question.domain !== setup.domain) {
      return false
    }

    if (setup.topic !== 'all' && question.topic !== setup.topic) {
      return false
    }

    if (setup.reviewMissed && !missedIds.includes(question.id)) {
      return false
    }

    return true
  })
}

// Theme Toggle Component
function ThemeToggle({ theme, onToggle }: { theme: 'light' | 'dark', onToggle: () => void }) {
  return (
    <button 
      className="theme-toggle" 
      onClick={onToggle}
      aria-label={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`}
      title={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`}
    >
      {theme === 'light' ? (
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
        </svg>
      ) : (
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
        </svg>
      )}
    </button>
  )
}

function App() {
  const [manifest, setManifest] = useState<DeckManifest | null>(null)
  const [manifestError, setManifestError] = useState('')
  const [selectedExamSlug, setSelectedExamSlug] = useState('')
  const [setup, setSetup] = useState<SetupState>(defaultSetup)
  const [setupError, setSetupError] = useState('')
  const [deckCache, setDeckCache] = useState<Record<string, ExamDeck>>({})
  const [loadingDeckSlug, setLoadingDeckSlug] = useState('')
  const [session, setSession] = useState<SessionState | null>(null)
  const [result, setResult] = useState<SessionResult | null>(null)
  const [progress, setProgress] = useState<ProgressMap>({})
  const [elapsedSeconds, setElapsedSeconds] = useState(0)

  // Theme management
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    const savedTheme = window.localStorage.getItem('theme')
    if (savedTheme === 'light' || savedTheme === 'dark') {
      return savedTheme
    }
    // Check system preference
    if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
      return 'dark'
    }
    return 'light'
  })

  // Apply theme to document
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    window.localStorage.setItem('theme', theme)
  }, [theme])

  const toggleTheme = () => {
    setTheme((prevTheme) => (prevTheme === 'light' ? 'dark' : 'light'))
  }

  useEffect(() => {
    setProgress(readProgress())

    const loadManifest = async () => {
      try {
        const response = await fetch(getDataUrl('exams.json'))

        if (!response.ok) {
          throw new Error(`Unable to load exam data (${response.status})`)
        }

        const nextManifest = (await response.json()) as DeckManifest
        setManifest(nextManifest)
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error'
        setManifestError(message)
      }
    }

    void loadManifest()
  }, [])

  useEffect(() => {
    if (!session) {
      setElapsedSeconds(0)
      return
    }

    setElapsedSeconds(Math.max(0, Math.floor((Date.now() - session.startedAt) / 1000)))

    const timer = window.setInterval(() => {
      setElapsedSeconds(Math.max(0, Math.floor((Date.now() - session.startedAt) / 1000)))
    }, 1000)

    return () => window.clearInterval(timer)
  }, [session])

  const selectedExam = manifest?.exams.find((exam) => exam.slug === selectedExamSlug) ?? null
  const selectedDeck = selectedExamSlug ? deckCache[selectedExamSlug] : undefined
  const selectedProgress = selectedExamSlug ? progress[selectedExamSlug] : undefined

  const availableDomains = selectedDeck
    ? Array.from(new Set(selectedDeck.questions.map((question) => question.domain))).sort()
    : selectedExam?.domains ?? []

  const availableTopics = selectedDeck
    ? Array.from(
        new Set(
          selectedDeck.questions
            .filter((question) => setup.domain === 'all' || question.domain === setup.domain)
            .map((question) => question.topic),
        ),
      ).sort()
    : selectedExam?.topics ?? []

  const matchingQuestions = selectedDeck
    ? filterQuestions(selectedDeck.questions, setup, selectedProgress?.missedIds ?? [])
    : []

  const currentQuestion = session && selectedDeck
    ? selectedDeck.questions.find((question) => question.id === session.questionIds[session.questionIndex])
    : null

  const resultQuestions = result && selectedDeck
    ? selectedDeck.questions.filter((question) => result.missedIds.includes(question.id))
    : []

  async function loadDeck(examSlug: string) {
    if (deckCache[examSlug]) {
      return deckCache[examSlug]
    }

    setLoadingDeckSlug(examSlug)

    try {
      const response = await fetch(getDataUrl(`decks/${examSlug}.json`))

      if (!response.ok) {
        throw new Error(`Unable to load exam (${response.status})`)
      }

      const deck = (await response.json()) as ExamDeck
      setDeckCache((currentCache) => ({
        ...currentCache,
        [examSlug]: deck,
      }))

      return deck
    } finally {
      setLoadingDeckSlug('')
    }
  }

  async function handleExamSelection(examSlug: string) {
    setSelectedExamSlug(examSlug)
    setSetup(defaultSetup)
    setSetupError('')
    setResult(null)
    setSession(null)
    setManifestError('')

    if (examSlug) {
      try {
        await loadDeck(examSlug)
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error'
        setManifestError(message)
      }
    }
  }

  async function handleStartSession() {
    if (!selectedExamSlug) {
      return
    }

    try {
      const deck = await loadDeck(selectedExamSlug)
      const filteredQuestions = filterQuestions(deck.questions, setup, selectedProgress?.missedIds ?? [])

      if (filteredQuestions.length === 0) {
        setSetupError('No questions match the current filters. Try changing your selection or disable missed-only review.')
        return
      }

      setSetupError('')

      startTransition(() => {
        setResult(null)
        setSession({
          examSlug: selectedExamSlug,
          mode: setup.mode,
          questionIds: filteredQuestions.map((question) => question.id),
          questionIndex: 0,
          answers: {},
          selectedOption: null,
          revealAnswer: false,
          startedAt: Date.now(),
        })
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      setSetupError(message)
    }
  }

  function updateSetup<K extends keyof SetupState>(key: K, value: SetupState[K]) {
    setSetup((currentSetup) => ({
      ...currentSetup,
      [key]: value,
      ...(key === 'domain' ? { topic: 'all' } : {}),
    }))
    setSetupError('')
  }

  function handleOptionSelect(optionKey: 'A' | 'B' | 'C') {
    if (!session) {
      return
    }

    setSession({
      ...session,
      selectedOption: optionKey,
    })
  }

  function completeSession(updatedAnswers: Record<string, StoredAnswer>) {
    if (!session) {
      return
    }

    const correctCount = Object.values(updatedAnswers).filter((answer) => answer.correct).length
    const missedIds = session.questionIds.filter((questionId) => !updatedAnswers[questionId]?.correct)
    const completedAt = new Date().toISOString()
    const nextProgress = {
      ...progress,
      [session.examSlug]: {
        lastCompletedAt: completedAt,
        lastMode: session.mode,
        lastScore: correctCount,
        lastTotal: session.questionIds.length,
        missedIds,
      },
    }

    writeProgress(nextProgress)
    setProgress(nextProgress)
    setResult({
      examSlug: session.examSlug,
      mode: session.mode,
      total: session.questionIds.length,
      correctCount,
      missedIds,
      elapsedSeconds,
      completedAt,
    })
    setSession(null)
  }

  function handleSubmitAnswer() {
    if (!session || !currentQuestion || !session.selectedOption) {
      return
    }

    const updatedAnswers = {
      ...session.answers,
      [currentQuestion.id]: {
        selected: session.selectedOption,
        correct: session.selectedOption === currentQuestion.correctOption,
      },
    }

    if (session.mode === 'practice') {
      setSession({
        ...session,
        answers: updatedAnswers,
        revealAnswer: true,
      })
      return
    }

    if (session.questionIndex === session.questionIds.length - 1) {
      completeSession(updatedAnswers)
      return
    }

    setSession({
      ...session,
      answers: updatedAnswers,
      questionIndex: session.questionIndex + 1,
      selectedOption: null,
      revealAnswer: false,
    })
  }

  function handleAdvanceQuestion() {
    if (!session) {
      return
    }

    if (session.questionIndex === session.questionIds.length - 1) {
      completeSession(session.answers)
      return
    }

    setSession({
      ...session,
      questionIndex: session.questionIndex + 1,
      selectedOption: null,
      revealAnswer: false,
    })
  }

  function handleBackToSetup() {
    setSession(null)
    setResult(null)
  }

  function handleStartMissedReview() {
    setSetup((currentSetup) => ({
      ...currentSetup,
      reviewMissed: true,
    }))
    setResult(null)
  }

  /* ─── Setup view ─── */
  if (!session && !result) {
    return (
      <>
        <ThemeToggle theme={theme} onToggle={toggleTheme} />
        <div className="app-shell">
          <header className="site-header">
            <h1>Microsoft Certification Practice</h1>
            <p>Select an exam, choose your mode, and start practicing.</p>
          </header>

        {manifestError && <div className="alert error">{manifestError}</div>}

        <div className="card">
          <h2 className="card-title">Exam Setup</h2>

          <div className="field">
            <label htmlFor="exam-select">Exam</label>
            <select
              id="exam-select"
              value={selectedExamSlug}
              onChange={(event) => { void handleExamSelection(event.target.value) }}
            >
              <option value="">Choose an exam...</option>
              {manifest?.exams.map((exam) => (
                <option key={exam.slug} value={exam.slug}>
                  {exam.code} &mdash; {exam.title} ({exam.questionCount} questions)
                </option>
              ))}
            </select>
          </div>

          {selectedExam && (
            <>
              {selectedProgress && (
                <div className="progress-summary">
                  <div className="progress-stat">
                    <span className="stat-label">Last attempt</span>
                    <strong>{formatDate(selectedProgress.lastCompletedAt)}</strong>
                  </div>
                  <div className="progress-stat">
                    <span className="stat-label">Last score</span>
                    <strong>{getProgressLabel(selectedProgress)}</strong>
                  </div>
                  <div className="progress-stat">
                    <span className="stat-label">Missed</span>
                    <strong>{selectedProgress.missedIds.length} questions</strong>
                  </div>
                </div>
              )}

              <div className="field">
                <label>Mode</label>
                <div className="mode-toggle" role="group" aria-label="Session mode">
                  <button
                    type="button"
                    className={`mode-btn ${setup.mode === 'practice' ? 'active' : ''}`}
                    onClick={() => updateSetup('mode', 'practice')}
                  >
                    Practice
                  </button>
                  <button
                    type="button"
                    className={`mode-btn ${setup.mode === 'timed' ? 'active' : ''}`}
                    onClick={() => updateSetup('mode', 'timed')}
                  >
                    Timed Quiz
                  </button>
                </div>
              </div>

              <p className="mode-hint">
                {setup.mode === 'practice'
                  ? 'You will see the correct answer and explanation after each question.'
                  : 'Questions are scored at the end. No answers are revealed during the quiz.'}
              </p>

              <div className="filter-row">
                <div className="field">
                  <label htmlFor="domain-select">Domain</label>
                  <select
                    id="domain-select"
                    value={setup.domain}
                    onChange={(event) => updateSetup('domain', event.target.value)}
                  >
                    <option value="all">All domains</option>
                    {availableDomains.map((domain) => (
                      <option key={domain} value={domain}>{domain}</option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="topic-select">Topic</label>
                  <select
                    id="topic-select"
                    value={setup.topic}
                    onChange={(event) => updateSetup('topic', event.target.value)}
                  >
                    <option value="all">All topics</option>
                    {availableTopics.map((topic) => (
                      <option key={topic} value={topic}>{topic}</option>
                    ))}
                  </select>
                </div>
              </div>

              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={setup.reviewMissed}
                  onChange={(event) => updateSetup('reviewMissed', event.target.checked)}
                />
                <span>Only review previously missed questions</span>
              </label>

              <div className="setup-footer">
                <span className="match-count">
                  {matchingQuestions.length} question{matchingQuestions.length !== 1 ? 's' : ''} match
                </span>
                <button
                  type="button"
                  className="btn-primary"
                  style={{ width: 'auto' }}
                  onClick={() => { void handleStartSession() }}
                  disabled={loadingDeckSlug === selectedExam.slug}
                >
                  {loadingDeckSlug === selectedExam.slug ? 'Loading...' : 'Start Session'}
                </button>
              </div>

              {setupError && <div className="alert error" style={{ marginTop: 12 }}>{setupError}</div>}
            </>
          )}
        </div>
      </div>
      </>
    )
  }

  /* ─── Session view ─── */
  if (session && currentQuestion) {
    return (
      <>
        <ThemeToggle theme={theme} onToggle={toggleTheme} />
        <div className="app-shell">
          <button type="button" className="back-link" onClick={handleBackToSetup}>
            &larr; Back to setup
          </button>

        <div className="card">
          <div className="session-header">
            <h2>
              Question {session.questionIndex + 1} of {session.questionIds.length}
            </h2>
            <div className="session-badges">
              <span className="badge primary">
                {session.mode === 'practice' ? 'Practice' : 'Timed Quiz'}
              </span>
              <span className="badge">{formatElapsedTime(elapsedSeconds)}</span>
            </div>
          </div>

          <div className="progress-bar" aria-hidden="true">
            <span
              style={{
                width: `${((session.questionIndex + 1) / session.questionIds.length) * 100}%`,
              }}
            />
          </div>

          <div className="question-meta">
            <span className="badge">{currentQuestion.domain}</span>
            <span className="badge">{currentQuestion.topic}</span>
          </div>

          <div
            className="question-prompt"
            dangerouslySetInnerHTML={{ __html: sanitizeHtml(currentQuestion.promptHtml) }}
          />

          <div className="option-list" role="list">
            {currentQuestion.options.map((option) => {
              const isSelected = session.selectedOption === option.key
              const isCorrect = session.revealAnswer && currentQuestion.correctOption === option.key
              const isIncorrectSelection =
                session.revealAnswer && isSelected && currentQuestion.correctOption !== option.key

              return (
                <button
                  key={option.key}
                  type="button"
                  className={[
                    'option-card',
                    isSelected ? 'selected' : '',
                    isCorrect ? 'correct' : '',
                    isIncorrectSelection ? 'incorrect' : '',
                  ].filter(Boolean).join(' ')}
                  onClick={() => handleOptionSelect(option.key)}
                  disabled={session.revealAnswer}
                >
                  <span className="option-key">{option.key}</span>
                  <span dangerouslySetInnerHTML={{ __html: sanitizeHtml(option.label) }} />
                </button>
              )
            })}
          </div>

          {!session.revealAnswer ? (
            <div className="session-actions">
              <button
                type="button"
                className="btn-primary"
                disabled={!session.selectedOption}
                onClick={handleSubmitAnswer}
              >
                {session.mode === 'practice'
                  ? 'Check Answer'
                  : session.questionIndex === session.questionIds.length - 1
                    ? 'Finish Quiz'
                    : 'Next'}
              </button>
            </div>
          ) : (
            <div className="answer-reveal">
              <h3>
                Correct: {currentQuestion.correctOption}) {currentQuestion.correctLabel}
              </h3>

              {currentQuestion.rationaleHtml && (
                <div>
                  <p className="rationale-label">Explanation</p>
                  <div
                    className="rationale-text"
                    dangerouslySetInnerHTML={{ __html: sanitizeHtml(currentQuestion.rationaleHtml) }}
                  />
                </div>
              )}

              {currentQuestion.extraHtml && (
                <div>
                  <p className="rationale-label">Additional context</p>
                  <div
                    className="rationale-text"
                    dangerouslySetInnerHTML={{ __html: sanitizeHtml(currentQuestion.extraHtml) }}
                  />
                </div>
              )}

              <div className="session-actions">
                <button type="button" className="btn-primary" onClick={handleAdvanceQuestion}>
                  {session.questionIndex === session.questionIds.length - 1 ? 'Finish Session' : 'Next Question'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
      </>
    )
  }

  /* ─── Results view ─── */
  if (result) {
    return (
      <>
        <ThemeToggle theme={theme} onToggle={toggleTheme} />
        <div className="app-shell">
          <button type="button" className="back-link" onClick={handleBackToSetup}>
            &larr; Back to setup
          </button>

        <div className="card">
          <h2 className="card-title">
            {selectedExam?.code} {result.mode === 'practice' ? 'Practice' : 'Timed Quiz'} Complete
          </h2>

          <div className="results-grid">
            <div className="progress-stat">
              <span className="stat-label">Score</span>
              <strong>{result.correctCount} / {result.total}</strong>
            </div>
            <div className="progress-stat">
              <span className="stat-label">Percentage</span>
              <strong>{Math.round((result.correctCount / result.total) * 100)}%</strong>
            </div>
            <div className="progress-stat">
              <span className="stat-label">Missed</span>
              <strong>{result.missedIds.length}</strong>
            </div>
            <div className="progress-stat">
              <span className="stat-label">Time</span>
              <strong>{formatElapsedTime(result.elapsedSeconds)}</strong>
            </div>
          </div>

          <div className="results-actions">
            <button
              type="button"
              className="btn-primary"
              onClick={() => { void handleStartSession() }}
            >
              Try Again
            </button>
            <button
              type="button"
              className="btn-secondary"
              onClick={handleStartMissedReview}
              disabled={result.missedIds.length === 0}
            >
              Review Missed Questions
            </button>
          </div>

          {resultQuestions.length > 0 ? (
            <div className="missed-list">
              <p className="missed-list-title">Questions to revisit</p>
              {resultQuestions.map((question) => (
                <article key={question.id} className="missed-card">
                  <span className="badge">{question.topic}</span>
                  <h3>{buildExcerpt(question.promptHtml)}</h3>
                  <p>
                    Correct: {question.correctOption}) {question.correctLabel}
                  </p>
                </article>
              ))}
            </div>
          ) : (
            <div className="alert success">Perfect score — no missed questions!</div>
          )}
        </div>
      </div>
      </>
    )
  }

  return null
}

export default App
