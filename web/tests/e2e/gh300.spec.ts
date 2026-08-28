import { expect, test } from '@playwright/test'

const examOption = 'GH-300 — GitHub Copilot (100 questions)'

test('starts a GH-300 practice session with localized taxonomy', async ({ page }) => {
  await page.goto('/')

  await page.getByLabel('Exam').selectOption({ label: examOption })
  await expect(page.getByLabel('Domain')).toContainText('Responsible AI')
  await page.getByLabel('Domain').selectOption('ResponsibleAI')
  await expect(page.getByLabel('Topic')).toContainText('Responsible AI principles')

  await page.getByLabel('Number of questions').selectOption('10')
  await page.getByRole('button', { name: 'Start Session' }).click()

  await expect(page.getByRole('heading', { name: 'Question 1 of 10' })).toBeVisible()
  await expect(page.getByText('Responsible AI', { exact: true })).toBeVisible()

  await page.locator('.option-card').first().click()
  await page.getByRole('button', { name: 'Check Answer' }).click()
  await expect(page.getByText('Explanation', { exact: true })).toBeVisible()
  await expect(page.getByText('Additional context', { exact: true })).toBeVisible()
})

test('removes stale missed-question IDs after a deck refresh', async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem('certification-flashcards-progress', JSON.stringify({
      gh300: {
        deckVersion: '2026-03-23',
        lastCompletedAt: '2026-03-23T12:00:00.000Z',
        lastScore: 9,
        lastTotal: 10,
        missedIds: ['gh300-obsolete-question'],
      },
    }))
  })
  await page.goto('/')

  await page.getByLabel('Exam').selectOption({ label: examOption })
  await expect(page.getByText('0 questions', { exact: true })).toBeVisible()
  await page.getByText('Only review previously missed questions').click()
  await expect(page.getByText('0 questions match', { exact: true })).toBeVisible()
})

test('shows French GH-300 metadata and taxonomy labels', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Switch to French' }).click()

  await page.getByLabel('Examen').selectOption({ label: examOption })
  await expect(page.getByLabel('Domaine')).toContainText('IA responsable')
  await expect(page.getByLabel('Nombre de questions')).toContainText('Toutes les questions')
})
