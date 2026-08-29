import type { ExamDeck } from '../types'
import type { ChallengeSettings } from './contracts'
import type { HostSetupValue } from './ChallengeViews'

export function settingsFromHost(host: HostSetupValue, deck: ExamDeck): ChallengeSettings {
  return {
    examSlug: host.examSlug,
    deckVersion: deck.exam.deckVersion,
    scope: host.domain === 'all' ? { kind: 'all' } : { kind: 'domain', domain: host.domain },
    questionCount: host.questionCount,
    timerSeconds: host.timerSeconds,
  }
}