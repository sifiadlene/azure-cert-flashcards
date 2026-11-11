import { expect, test } from '@playwright/test'
import studyGuideSnapshot from '../../public/data/study-guide-dates.json' with { type: 'json' }
import studyGuideReviews from '../../public/data/study-guide-reviews.json' with { type: 'json' }

const fixtureDates: Record<string, string> = {
  'GH-300': '2026-02-01',
  'AZ-104': '2026-03-02',
}
const dateFixture = {
  ...studyGuideSnapshot,
  exams: studyGuideSnapshot.exams.map((exam) => {
    const pageUpdatedOn = fixtureDates[exam.code]
    return pageUpdatedOn
      ? {
          ...exam,
          pageUpdatedOn,
          pageUpdatedAt: `${pageUpdatedOn}T00:00:00.000Z`,
          pageUpdateEvidence: `Last updated on ${pageUpdatedOn}`,
        }
      : exam
  }),
}

test.use({ timezoneId: 'America/Los_Angeles' })

test('shows both dates for the selected solo exam and updates them by code', async ({ page }) => {
  await page.route('**/data/study-guide-dates.json', (route) => route.fulfill({ json: dateFixture }))
  await page.goto('/')
  await expect(page.locator('.exam-dates')).toHaveCount(0)

  await page.getByLabel('Exam').selectOption('gh300')
  const dates = page.locator('.exam-dates')
  await expect(dates.getByText('Flashcard deck generated')).toBeVisible()
  await expect(dates.getByText('Study guide page last updated')).toBeVisible()
  await expect(dates.locator('time').nth(0)).toHaveText('Aug 28, 2026')
  await expect(dates.locator('time').nth(1)).toHaveText('Feb 1, 2026')
  await expect(dates.getByRole('link', { name: 'View study guide' }))
    .toHaveAttribute('href', 'https://learn.microsoft.com/en-us/credentials/certifications/resources/study-guides/gh-300')

  await page.getByLabel('Exam').selectOption('az104')
  await expect(dates.locator('time').nth(0)).toHaveText('Mar 24, 2026')
  await expect(dates.locator('time').nth(1)).toHaveText('Mar 2, 2026')
  await expect(dates.getByRole('link', { name: 'View study guide' }))
    .toHaveAttribute('href', 'https://learn.microsoft.com/en-us/credentials/certifications/resources/study-guides/az-104')

  await page.getByLabel('Exam').selectOption('')
  await expect(dates).toHaveCount(0)
})

test('shows localized dates in challenge setup and changes them with the exam', async ({ page }) => {
  await page.route('**/data/study-guide-dates.json', (route) => route.fulfill({ json: dateFixture }))
  await page.goto('/')
  await page.getByRole('button', { name: /Live Challenge/ }).click()
  await page.getByRole('button', { name: 'Switch to French' }).click()
  await expect(page.locator('.exam-dates')).toHaveCount(0)

  await page.getByLabel('Examen').selectOption('gh300')
  const dates = page.locator('.exam-dates')
  await expect(dates.getByText('Jeu de cartes généré le')).toBeVisible()
  await expect(dates.getByText('Page du guide d’étude mise à jour le')).toBeVisible()
  await expect(dates.locator('time').nth(0)).toHaveText(/28.*août.*2026/)
  await expect(dates.locator('time').nth(1)).toHaveText(/1.*févr.*2026/)
  await expect(dates.getByRole('link', { name: 'Voir le guide d’étude' }))
    .toHaveAttribute('href', 'https://learn.microsoft.com/en-us/credentials/certifications/resources/study-guides/gh-300')

  await page.getByLabel('Examen').selectOption('az104')
  await expect(dates.locator('time').nth(0)).toHaveAttribute('datetime', '2026-03-24')
  await expect(dates.locator('time').nth(1)).toHaveAttribute('datetime', '2026-03-02')
})

test('shows current AI-103 review status in solo and challenge setup in English and French', async ({ page }) => {
  await page.route('**/data/study-guide-dates.json', (route) => route.fulfill({ json: studyGuideSnapshot }))
  await page.route('**/data/study-guide-reviews.json', (route) => route.fulfill({ json: studyGuideReviews }))
  await page.goto('/')
  await page.getByLabel('Exam').selectOption('ai103')

  const dates = page.locator('.exam-dates')
  await expect(dates.getByText('Review complete; coverage gaps remain')).toBeVisible()
  await expect(dates.locator('time').nth(2)).toHaveAttribute('datetime', '2026-11-08')
  await expect(dates.getByText('Guide revision: Oct 31, 2026. Deck version: Aug 29, 2026.')).toBeVisible()

  await page.getByRole('button', { name: 'Switch to French' }).click()
  await expect(dates.getByText('Revue du jeu de cartes terminée ; des lacunes de couverture subsistent')).toBeVisible()
  await expect(dates.locator('time').nth(2)).toHaveAttribute('datetime', '2026-11-08')
  await expect(dates.getByText(/Révision du guide : 31.*oct.*2026\. Version du jeu : 29.*août.*2026\./)).toBeVisible()

  await page.getByRole('button', { name: /Défi en direct/ }).click()
  await page.getByLabel('Examen').selectOption('ai103')
  const challengeDates = page.locator('.exam-dates')
  await expect(challengeDates.getByText('Revue du jeu de cartes terminée ; des lacunes de couverture subsistent')).toBeVisible()
  await expect(challengeDates.locator('time').nth(2)).toHaveAttribute('datetime', '2026-11-08')
})

test('does not show current review status when the study-guide revision has changed', async ({ page }) => {
  const changedGuide = {
    ...studyGuideSnapshot,
    exams: studyGuideSnapshot.exams.map((exam) => exam.code === 'AI-103'
      ? { ...exam, pageUpdatedOn: '2026-11-05' }
      : exam),
  }
  await page.route('**/data/study-guide-dates.json', (route) => route.fulfill({ json: changedGuide }))
  const matchingGuide = changedGuide.exams.find((exam) => exam.code === 'GH-300')
  if (!matchingGuide?.pageUpdatedOn) throw new Error('Matching guide fixture is missing')
  const reviews = {
    ...studyGuideReviews,
    reviews: [
      ...studyGuideReviews.reviews,
      {
        code: matchingGuide.code,
        guideUrl: matchingGuide.guideUrl,
        guideUpdatedOn: matchingGuide.pageUpdatedOn,
        deckVersion: '2026-08-28',
        reviewedOn: '2026-11-08',
        status: 'gaps',
      },
    ],
  }
  await page.route('**/data/study-guide-reviews.json', (route) => route.fulfill({ json: reviews }))
  await page.goto('/')
  await page.getByLabel('Exam').selectOption('gh300')
  const dates = page.locator('.exam-dates')
  await expect(dates.getByText('Review complete; coverage gaps remain')).toBeVisible()
  await page.getByLabel('Exam').selectOption('ai103')
  await expect(dates.locator('time').nth(1)).toHaveAttribute('datetime', '2026-11-05')
  await expect(dates.getByText('Review complete; coverage gaps remain')).toHaveCount(0)
})

test('matches review status against the loaded deck version', async ({ page }) => {
  await page.route('**/data/decks/ai103.json', async (route) => {
    const response = await route.fetch()
    const deck = await response.json() as { exam: { deckVersion: string } }
    await route.fulfill({
      response,
      json: {
        ...deck,
        exam: { ...deck.exam, deckVersion: '2026-11-09' },
      },
    })
  })
  await page.goto('/')
  await page.getByLabel('Exam').selectOption('ai103')
  await expect(page.getByRole('button', { name: 'Start Session' })).toBeEnabled()
  await expect(page.locator('.exam-dates').getByText('Review complete; coverage gaps remain')).toHaveCount(0)
})

test('reports review metadata errors without blocking solo practice', async ({ page }) => {
  await page.route('**/data/study-guide-reviews.json', (route) => route.fulfill({ status: 503, body: 'Unavailable' }))
  await page.goto('/')
  await page.getByLabel('Exam').selectOption('ai103')
  await expect(page.locator('.exam-dates').getByText('Unable to load the review status.', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Switch to French' }).click()
  await expect(page.locator('.exam-dates').getByText('Impossible de charger l’état de la revue du jeu de cartes.', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Passer en anglais' }).click()
  await page.getByRole('button', { name: 'Start Session' }).click()
  await expect(page.getByRole('heading', { name: /Question 1 of/ })).toBeVisible()
})

for (const scenario of [
  {
    name: 'a missing exam entry',
    response: {
      status: 200,
      json: { ...studyGuideSnapshot, exams: studyGuideSnapshot.exams.filter((exam) => exam.code === 'AZ-104') },
    },
    message: 'Not available',
  },
  {
    name: 'an empty snapshot',
    response: { status: 200, json: { schemaVersion: 1, retrievedAt: '2026-11-06T03:37:24.980Z', exams: [] } },
    message: 'Unable to load the study-guide date.',
  },
  {
    name: 'malformed snapshot data',
    response: { status: 200, json: { schemaVersion: 2, exams: [] } },
    message: 'Unable to load the study-guide date.',
  },
  {
    name: 'a failed snapshot request',
    response: { status: 503, body: 'Unavailable' },
    message: 'Unable to load the study-guide date.',
  },
]) {
  test(`${scenario.name} leaves solo practice usable`, async ({ page }) => {
    await page.route('**/data/study-guide-dates.json', (route) => route.fulfill(scenario.response))
    await page.goto('/')
    await page.getByLabel('Exam').selectOption('gh300')
    await expect(page.locator('.exam-dates').getByText(scenario.message, { exact: true })).toBeVisible()
    await expect(page.locator('.exam-dates time')).toHaveCount(1)
    await expect(page.locator('.exam-dates a')).toHaveCount(0)
    await page.getByRole('button', { name: 'Start Session' }).click()
    await expect(page.getByRole('heading', { name: /Question 1 of/ })).toBeVisible()
  })
}

test('shows a localized guide error without blocking challenge setup', async ({ page }) => {
  await page.route('**/data/study-guide-dates.json', (route) => route.fulfill({ status: 503, body: 'Unavailable' }))
  await page.goto('/')
  await page.getByRole('button', { name: /Live Challenge/ }).click()
  await page.getByRole('button', { name: 'Switch to French' }).click()
  await page.getByLabel('Pseudonyme').first().fill('Hôte')
  await page.getByLabel('Examen').selectOption('gh300')
  await expect(page.getByText('Impossible de charger la date du guide d’étude.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Créer le défi' })).toBeEnabled()
})

test('keeps the dates visible and the guide link keyboard accessible on mobile in both themes', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 720 })
  await page.addInitScript(() => window.localStorage.setItem('theme', 'light'))
  await page.goto('/')
  const select = page.getByLabel('Exam')
  await select.selectOption('gh300')
  const dates = page.locator('.exam-dates')
  const link = dates.getByRole('link', { name: 'View study guide' })
  const gh300Guide = studyGuideSnapshot.exams.find((exam) => exam.code === 'GH-300')
  if (!gh300Guide) throw new Error('GH-300 is missing from the study-guide snapshot')
  await expect(link).toBeVisible()
  await expect(dates.locator('time').nth(1)).toHaveAttribute('datetime', gh300Guide.pageUpdatedOn)
  await select.focus()
  await page.keyboard.press('Tab')
  await expect(link).toBeFocused()

  for (const theme of ['light', 'dark']) {
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
    await expect(dates.getByText('Flashcard deck generated')).toBeVisible()
    await expect(dates.getByText('Study guide page last updated')).toBeVisible()
    await expect(link).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false)
    if (theme === 'light') await page.getByRole('button', { name: 'Switch to dark mode' }).click()
  }

  await select.selectOption('ai103')
  await expect(dates.getByText('Review complete; coverage gaps remain')).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false)
})
