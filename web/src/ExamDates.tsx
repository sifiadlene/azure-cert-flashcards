import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { formatCalendarDate, isCalendarDate, loadStudyGuideDates, type StudyGuideDate } from './studyGuideDates'
import type { ExamSummary } from './types'

type GuideState =
  | { status: 'loading' }
  | { status: 'ready'; dates: Map<string, StudyGuideDate> }
  | { status: 'error' }

export function ExamDates({ exam }: { exam: ExamSummary }) {
  const { t, i18n } = useTranslation()
  const [guideState, setGuideState] = useState<GuideState>({ status: 'loading' })
  const language = i18n.language.startsWith('fr') ? 'fr' : 'en'

  useEffect(() => {
    let active = true
    loadStudyGuideDates()
      .then((dates) => {
        if (active) setGuideState({ status: 'ready', dates })
      })
      .catch((error: unknown) => {
        if (active) {
          console.error('Unable to load study-guide dates', error)
          setGuideState({ status: 'error' })
        }
      })
    return () => { active = false }
  }, [])

  const guide = guideState.status === 'ready' ? guideState.dates.get(exam.code) : undefined

  return (
    <dl className="exam-dates">
      <div>
        <dt>{t('setup.deckGenerated')}</dt>
        <dd>
          {isCalendarDate(exam.updatedOn)
            ? <time dateTime={exam.updatedOn}>{formatCalendarDate(exam.updatedOn, language)}</time>
            : t('setup.dateUnavailable')}
        </dd>
      </div>
      <div>
        <dt>{t('setup.guideUpdated')}</dt>
        <dd>
          {guideState.status === 'loading' && <span role="status">{t('setup.guideLoading')}</span>}
          {guideState.status === 'error' && <span role="status">{t('setup.guideError')}</span>}
          {guideState.status === 'ready' && !guide && t('setup.dateUnavailable')}
          {guide && <>
            <time dateTime={guide.pageUpdatedOn}>{formatCalendarDate(guide.pageUpdatedOn, language)}</time>
            {' · '}
            <a href={guide.guideUrl} target="_blank" rel="noopener noreferrer">{t('setup.viewStudyGuide')}</a>
          </>}
        </dd>
      </div>
    </dl>
  )
}
