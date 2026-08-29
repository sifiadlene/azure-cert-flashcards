import { useTranslation } from 'react-i18next'

interface RequestExamTriggerProps {
  onOpen: (trigger: HTMLButtonElement) => void
}

export function RequestExamTrigger({ onOpen }: RequestExamTriggerProps) {
  const { t } = useTranslation()
  return (
    <button
      type="button"
      className="request-exam-trigger"
      onClick={(event) => onOpen(event.currentTarget)}
    >
      <span aria-hidden="true">＋</span>
      {t('examRequest.trigger')}
    </button>
  )
}
