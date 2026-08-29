import { expect, test, type Page } from '@playwright/test'

const examOption = 'GH-300 — GitHub Copilot'

async function createRoom(host: Page) {
  await host.goto('/')
  await host.getByRole('button', { name: /Live Challenge/ }).click()
  await host.getByLabel('Nickname').first().fill('Host Alice')
  await host.getByLabel('Exam').selectOption({ label: examOption })
  await expect(host.getByRole('button', { name: 'Create challenge' })).toBeEnabled()
  await host.getByRole('button', { name: 'Create challenge' }).click()
  await expect(host.getByRole('heading', { name: 'Gather your challengers' })).toBeVisible()
  return (await host.locator('.room-code').textContent())?.trim() ?? ''
}

test('host and French guest complete a synchronized five-question challenge', async ({ browser }) => {
  const hostContext = await browser.newContext()
  const guestContext = await browser.newContext()
  const host = await hostContext.newPage()
  const guest = await guestContext.newPage()

  const roomCode = await createRoom(host)
  expect(roomCode).toHaveLength(6)

  await guest.goto(`/?challenge=${roomCode}`)
  await guest.getByRole('button', { name: 'Switch to French' }).click()
  await expect(guest.getByLabel('Code de salle')).toHaveValue(roomCode)
  await guest.getByLabel('Pseudonyme').last().fill('Invitée Béatrice')
  await guest.getByRole('button', { name: 'Rejoindre le défi' }).click()
  await expect(guest.getByRole('heading', { name: 'Rassemblez les participants' })).toBeVisible()

  await expect(host.getByText('Invitée Béatrice', { exact: true })).toBeVisible({ timeout: 6_000 })
  await host.getByRole('button', { name: 'Start challenge' }).click()
  await expect(host.getByText('Question 1 of 5', { exact: true })).toBeVisible()
  await expect(guest.getByText('Question 1 sur 5', { exact: true })).toBeVisible({ timeout: 4_000 })

  for (let round = 1; round <= 5; round += 1) {
    const hostQuestionId = await host.locator('[data-question-id]').getAttribute('data-question-id')
    await expect(guest.locator('[data-question-id]')).toHaveAttribute('data-question-id', hostQuestionId ?? '')
    await expect(host.locator('.challenge-reveal')).toHaveCount(0)
    await expect(guest.locator('.challenge-reveal')).toHaveCount(0)

    await Promise.all([
      host.locator('.option-card').first().click(),
      guest.locator('.option-card').last().click(),
    ])
    await Promise.all([
      host.getByRole('button', { name: 'Lock in answer' }).click(),
      guest.getByRole('button', { name: 'Verrouiller la réponse' }).click(),
    ])

    await expect(host.getByText('Answer reveal', { exact: true })).toBeVisible({ timeout: 5_000 })
    await expect(guest.getByText('Révélation de la réponse', { exact: true })).toBeVisible({ timeout: 5_000 })
    await expect(host.getByRole('heading', { name: 'Leaderboard' })).toBeVisible()
    await expect(guest.getByRole('heading', { name: 'Classement' })).toBeVisible()

    const nextAction = round === 5 ? 'Show final results' : 'Next question now'
    await host.getByRole('button', { name: nextAction }).click()
    if (round < 5) {
      await expect(host.getByText(`Question ${round + 1} of 5`, { exact: true })).toBeVisible()
      await expect(guest.getByText(`Question ${round + 1} sur 5`, { exact: true })).toBeVisible({ timeout: 4_000 })
    }
  }

  await expect(host.getByRole('heading', { name: 'Final standings' })).toBeVisible()
  await expect(guest.getByRole('heading', { name: 'Classement final' })).toBeVisible({ timeout: 4_000 })
  await expect(host.getByText('Host Alice', { exact: true }).first()).toBeVisible()
  await expect(guest.getByText('Invitée Béatrice', { exact: true }).first()).toBeVisible()
  await expect(host.getByRole('button', { name: 'Play again' })).toBeVisible()
  await expect(guest.getByRole('button', { name: 'Quitter le défi' })).toBeVisible()

  await hostContext.close()
  await guestContext.close()
})

test('multiplayer entry and lobby reflow in French at 320 pixels', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 720 })
  await page.goto('/')
  await page.getByRole('button', { name: /Live Challenge/ }).click()
  await page.getByRole('button', { name: 'Switch to French' }).click()
  await page.getByLabel('Pseudonyme').first().fill('Hôte Mobile')
  await page.getByLabel('Examen').selectOption({ label: examOption })
  await page.getByRole('button', { name: 'Créer le défi' }).click()
  await expect(page.getByRole('heading', { name: 'Rassemblez les participants' })).toBeVisible()

  expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false)
  for (const control of await page.locator('button:visible').all()) {
    const box = await control.boundingBox()
    expect(box?.height).toBeGreaterThanOrEqual(43.9)
    expect(box?.width).toBeGreaterThanOrEqual(43.9)
  }
})

test('invalid room errors remain actionable', async ({ page }) => {
  await page.goto('/?challenge=BAD234')
  await page.getByLabel('Nickname').last().fill('Guest')
  const responsePromise = page.waitForResponse((response) => response.url().includes('/api/rooms/BAD234/join'))
  await page.getByRole('button', { name: 'Join challenge' }).click()
  const response = await responsePromise
  expect(response.status()).toBe(404)
  await expect(page.getByRole('alert')).toContainText('invalid or the room is no longer available')
  await expect(page.getByRole('button', { name: 'Join challenge' })).toBeEnabled()
})

test('terminal credential failures clear the session and restore local exit actions', async ({ page }) => {
  await page.addInitScript(() => {
    window.sessionStorage.setItem('certification-flashcards-challenge-capability-v1', JSON.stringify({
      roomId: 'expired-room',
      roomCode: 'BAD234',
      playerId: 'former-player',
      role: 'player',
      token: 'expired-capability-token',
    }))
  })
  await page.route('**/api/rooms/expired-room', async (route) => {
    await route.fulfill({
      status: 401,
      contentType: 'application/json',
      body: JSON.stringify({ error: { kind: 'unauthorized', retryable: false } }),
    })
  })

  await page.goto('/?challenge=BAD234')
  await expect(page.getByRole('alert')).toContainText('room access is no longer valid')
  await expect(page.getByRole('button', { name: '← Solo Practice' })).toBeEnabled()
  await expect.poll(() => page.evaluate(() => window.sessionStorage.getItem('certification-flashcards-challenge-capability-v1'))).toBeNull()
})
