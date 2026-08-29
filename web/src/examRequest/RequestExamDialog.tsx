import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent, type MouseEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { loadExamCatalog } from '../examCatalog'
import type { ExamCatalogEntry } from '../types'
import {
  createExamRequestDraft,
  errorTranslationKey,
  ExamRequestApiClient,
  ExamRequestApiError,
  type ExamRequestDraft,
  type ExamRequestResult,
} from './apiClient'
import { TurnstileWidget } from './TurnstileWidget'

interface RequestExamDialogProps {
  onClose: () => void
  language: 'en' | 'fr'
  theme: 'light' | 'dark'
}

type CatalogState =
  | { kind: 'loading' }
  | { kind: 'ready'; exams: ExamCatalogEntry[] }
  | { kind: 'error' }

type SubmissionState =
  | { kind: 'idle' }
  | { kind: 'pending' }
  | { kind: 'success'; result: ExamRequestResult; exam: ExamCatalogEntry }
  | { kind: 'error'; error: ExamRequestApiError }

const focusableSelector = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

function fallbackError(): ExamRequestApiError {
  return new ExamRequestApiError('internal', true, 0)
}

export function RequestExamDialog({ onClose, language, theme }: RequestExamDialogProps) {
  const { t } = useTranslation()
  const dialogRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const successHeadingRef = useRef<HTMLHeadingElement>(null)
  const submissionRef = useRef<ExamRequestDraft | null>(null)
  const apiRef = useRef(new ExamRequestApiClient())
  const [catalogState, setCatalogState] = useState<CatalogState>({ kind: 'loading' })
  const [search, setSearch] = useState('')
  const [selectedCode, setSelectedCode] = useState('')
  const [turnstileToken, setTurnstileToken] = useState('')
  const [turnstileResetKey, setTurnstileResetKey] = useState(0)
  const [turnstileError, setTurnstileError] = useState(false)
  const [submission, setSubmission] = useState<SubmissionState>({ kind: 'idle' })

  const loadCatalog = useCallback(async (showLoading = true) => {
    if (showLoading) setCatalogState({ kind: 'loading' })
    try {
      const loaded = await loadExamCatalog()
      setCatalogState({ kind: 'ready', exams: loaded.requestableExams })
      return loaded.requestableExams
    } catch {
      setCatalogState({ kind: 'error' })
      return null
    }
  }, [])

  useEffect(() => {
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const frame = window.requestAnimationFrame(() => {
      void loadCatalog()
      searchRef.current?.focus()
    })
    return () => {
      window.cancelAnimationFrame(frame)
      document.body.style.overflow = previousOverflow
    }
  }, [loadCatalog])

  const exams = useMemo(
    () => catalogState.kind === 'ready' ? catalogState.exams : [],
    [catalogState],
  )
  const selectedExam = exams.find((exam) => exam.code === selectedCode)
  const filteredExams = useMemo(() => {
    const query = search.trim().toLocaleLowerCase()
    if (!query) return exams
    return exams.filter((exam) => `${exam.code} ${exam.title}`.toLocaleLowerCase().includes(query))
  }, [exams, search])

  useEffect(() => {
    if (submission.kind === 'success') successHeadingRef.current?.focus()
  }, [submission.kind])

  const handleVerified = useCallback((token: string) => {
    setTurnstileToken(token)
    setTurnstileError(false)
  }, [])
  const handleTurnstileUnavailable = useCallback(() => {
    setTurnstileToken('')
    setTurnstileError(true)
  }, [])
  const handleTurnstileExpired = useCallback(() => {
    setTurnstileToken('')
    setTurnstileError(false)
  }, [])

  function resetTurnstile() {
    setTurnstileToken('')
    setTurnstileResetKey((value) => value + 1)
  }

  function handleDialogKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape') {
      event.preventDefault()
      if (submission.kind !== 'pending') onClose()
      return
    }
    if (event.key !== 'Tab' || !dialogRef.current) return

    const controls = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(focusableSelector))
    const first = controls.at(0)
    const last = controls.at(-1)
    if (!first || !last) return
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }

  function handleBackdropClick(event: MouseEvent<HTMLDivElement>) {
    if (event.target === event.currentTarget && submission.kind !== 'pending') onClose()
  }

  function selectExam(code: string) {
    setSelectedCode(code)
    submissionRef.current = null
    setSubmission({ kind: 'idle' })
  }

  function handleSearchChange(value: string) {
    setSearch(value)
    if (!selectedCode) return
    const query = value.trim().toLocaleLowerCase()
    const selectionRemainsVisible = exams.some((exam) => exam.code === selectedCode
      && (!query || `${exam.code} ${exam.title}`.toLocaleLowerCase().includes(query)))
    if (!selectionRemainsVisible) {
      setSelectedCode('')
      submissionRef.current = null
      setSubmission({ kind: 'idle' })
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!selectedCode || !turnstileToken || submission.kind === 'pending') return

    const draft = submissionRef.current?.examCode === selectedCode
      ? submissionRef.current
      : createExamRequestDraft(selectedCode)
    submissionRef.current = draft
    setSubmission({ kind: 'pending' })

    const refreshedExams = await loadCatalog(false)
    if (!refreshedExams) {
      setSubmission({ kind: 'error', error: fallbackError() })
      return
    }
    const refreshedExam = refreshedExams.find((exam) => exam.code === selectedCode)
    if (!refreshedExam) {
      setSelectedCode('')
      setSubmission({ kind: 'error', error: new ExamRequestApiError('supported', false, 409) })
      return
    }

    try {
      const result = await apiRef.current.submit(draft, turnstileToken)
      setSubmission({ kind: 'success', result, exam: refreshedExam })
    } catch (error) {
      const apiError = error instanceof ExamRequestApiError ? error : fallbackError()
      setSubmission({ kind: 'error', error: apiError })
      if (apiError.kind !== 'network') resetTurnstile()
    }
  }

  const submissionError = submission.kind === 'error' ? submission.error : null
  const success = submission.kind === 'success' ? submission.result : null
  const successfulExam = submission.kind === 'success' ? submission.exam : null
  const isPending = submission.kind === 'pending'
  const sourcePageUrl = selectedExam?.sourcePageUrl ?? exams.at(0)?.sourcePageUrl
  const turnstileSiteKey = import.meta.env.VITE_TURNSTILE_BLOCK_SITE_KEY
    && new URLSearchParams(window.location.search).get('turnstile-test') === 'block'
    ? import.meta.env.VITE_TURNSTILE_BLOCK_SITE_KEY
    : import.meta.env.VITE_TURNSTILE_SITE_KEY ?? ''

  return (
    <div className="dialog-backdrop request-dialog-backdrop" onClick={handleBackdropClick} onKeyDown={handleDialogKeyDown}>
      <div
        ref={dialogRef}
        className="dialog request-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="request-exam-title"
        aria-describedby="request-exam-description"
      >
        <header className="request-dialog-header">
          <div>
            <p className="section-label">{t('examRequest.eyebrow')}</p>
            <h2 id="request-exam-title">{t('examRequest.title')}</h2>
          </div>
          <button type="button" className="dialog-close" aria-label={t('examRequest.close')} onClick={onClose} disabled={isPending}>×</button>
        </header>
        <p id="request-exam-description" className="request-dialog-description">{t('examRequest.description')}</p>

        {success ? (
          <section className="request-success" role="status" aria-live="polite">
            <span className="request-success-icon" aria-hidden="true">✓</span>
            <div>
              <h3 ref={successHeadingRef} tabIndex={-1}>{success.reused ? t('examRequest.reusedTitle') : t('examRequest.successTitle')}</h3>
              <p className="request-success-exam">
                <strong>{successfulExam?.code}</strong> — {successfulExam?.title}
              </p>
              <p>{success.reused ? t('examRequest.reusedMessage') : t('examRequest.successMessage')}</p>
              <a className="request-external-link" href={success.issueUrl} target="_blank" rel="noreferrer">
                {t('examRequest.viewIssue', { number: success.number })}
                <span className="sr-only"> ({t('examRequest.opensNewTab')})</span>
              </a>
            </div>
            <button type="button" className="btn-primary" onClick={onClose}>{t('examRequest.done')}</button>
          </section>
        ) : (
          <form aria-busy={isPending} onSubmit={(event) => { void handleSubmit(event) }}>
            <div className="field request-search-field">
              <label htmlFor="request-exam-search">{t('examRequest.searchLabel')}</label>
              <input
                ref={searchRef}
                id="request-exam-search"
                type="search"
                value={search}
                placeholder={t('examRequest.searchPlaceholder')}
                autoComplete="off"
                disabled={isPending}
                onChange={(event) => handleSearchChange(event.target.value)}
              />
            </div>

            {catalogState.kind === 'loading' && <div className="request-catalog-status" role="status">{t('examRequest.loadingExams')}</div>}
            {catalogState.kind === 'error' && <div className="alert error" role="alert">
              <span>{t('examRequest.errors.catalog')}</span>
              <button type="button" className="inline-action" disabled={isPending} onClick={() => { void loadCatalog() }}>{t('examRequest.retry')}</button>
            </div>}
            {catalogState.kind === 'ready' && (
              <fieldset className="request-exam-options">
                <legend className="sr-only">{t('examRequest.listLabel')}</legend>
                <p className="sr-only request-result-status" role="status" aria-live="polite" aria-atomic="true">
                  {filteredExams.length === 0
                    ? t('examRequest.noResults')
                    : t('examRequest.resultCount', { count: filteredExams.length })}
                </p>
                <div className="request-exam-list">
                  {filteredExams.map((exam) => (
                    <label key={exam.code} className={selectedCode === exam.code ? 'request-exam-option selected' : 'request-exam-option'}>
                      <input
                        type="radio"
                        name="requested-exam"
                        value={exam.code}
                        checked={selectedCode === exam.code}
                        disabled={isPending}
                        onChange={() => selectExam(exam.code)}
                      />
                      <span className="request-exam-code">{exam.code}</span>
                      <span className="request-exam-title">{exam.title}</span>
                    </label>
                  ))}
                  {filteredExams.length === 0 && <p className="request-empty" aria-hidden="true">{t('examRequest.noResults')}</p>}
                </div>
              </fieldset>
            )}

            <div className="request-source">
              <span>{t('examRequest.sourceAttribution')}</span>
              {sourcePageUrl && <a className="request-external-link" href={sourcePageUrl} target="_blank" rel="noreferrer">
                {t('examRequest.sourceLink')}
                <span className="sr-only"> ({t('examRequest.opensNewTab')})</span>
              </a>}
            </div>

            <section className="request-verification" aria-labelledby="request-verification-title">
              <div>
                <h3 id="request-verification-title">{t('examRequest.verificationTitle')}</h3>
                <p role="status" aria-live="polite">{turnstileToken ? t('examRequest.verified') : t('examRequest.verificationHint')}</p>
              </div>
              <TurnstileWidget
                siteKey={turnstileSiteKey}
                resetKey={turnstileResetKey}
                label={t('examRequest.turnstileLabel')}
                language={language}
                theme={theme}
                onVerified={handleVerified}
                onUnavailable={handleTurnstileUnavailable}
                onExpired={handleTurnstileExpired}
              />
            </section>
            {turnstileError && <div className="alert error" role="alert">{t('examRequest.errors.turnstileUnavailable')}</div>}
            {submissionError && <div className="alert error" role="alert">
              {t(errorTranslationKey(submissionError.kind), { seconds: submissionError.retryAfterSeconds ?? 60 })}
            </div>}
            {isPending && <div className="sr-only" role="status">{t('examRequest.submitting')}</div>}
            <div className="dialog-actions request-dialog-actions">
              <button type="button" className="btn-secondary" onClick={onClose} disabled={isPending}>{t('examRequest.cancel')}</button>
              <button type="submit" className="btn-primary" disabled={!selectedCode || !turnstileToken || isPending}>
                {isPending ? t('examRequest.submitting') : submissionError?.retryable ? t('examRequest.retry') : t('examRequest.submit')}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}
