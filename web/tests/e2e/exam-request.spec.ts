import { expect, test, type Locator, type Page } from '@playwright/test'

const officialAlwaysPassSiteKey = '1x00000000000000000000AA'
const officialAlwaysBlockSiteKey = '2x00000000000000000000AB'
const issueUrl = 'https://github.com/sifiadlene/azure-cert-flashcards/issues/73'

async function stubTurnstile(page: Page) {
  await page.route('https://challenges.cloudflare.com/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/javascript',
      body: `window.turnstile = {
        render: function (container, options) {
          container.setAttribute('data-rendered-sitekey', options.sitekey);
          container.setAttribute('data-rendered-action', options.action);
          container.setAttribute('data-rendered-size', options.size);
          container.setAttribute('data-rendered-language', options.language);
          container.setAttribute('data-rendered-theme', options.theme);
          var widget = document.createElement('div');
          widget.textContent = 'Cloudflare Turnstile test verification';
          widget.style.width = options.size === 'compact' ? '150px' : '300px';
          widget.style.height = options.size === 'compact' ? '140px' : '65px';
          container.replaceChildren(widget);
          setTimeout(function () {
            if (options.sitekey === '${officialAlwaysBlockSiteKey}') options['error-callback']();
            else options.callback('official-test-token');
          }, 0);
          return 'test-widget';
        },
        remove: function () {}
      };`,
    })
  })
}

async function openReadyDialog(page: Page, url = '/') {
  await page.goto(url)
  await page.getByRole('button', { name: 'Can’t find your exam? Request it' }).click()
  const dialog = page.getByRole('dialog', { name: 'Request an exam' })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByLabel('Search available exams')).toBeFocused()
  await expect(dialog.locator('.turnstile-widget')).toHaveAttribute('data-rendered-sitekey', officialAlwaysPassSiteKey)
  await expect(dialog.locator('.turnstile-widget')).toHaveAttribute('data-rendered-action', 'exam-request')
  return dialog
}

async function expectAccessibleTarget(link: Locator) {
  const box = await link.boundingBox()
  expect(box?.height).toBeGreaterThanOrEqual(44)
  expect(box?.width).toBeGreaterThanOrEqual(44)
}

async function selectExamAndSubmit(page: Page, code = 'AB-730') {
  const dialog = page.getByRole('dialog', { name: 'Request an exam' })
  await dialog.getByRole('radio', { name: new RegExp(code) }).check()
  await expect(dialog.getByRole('button', { name: 'Submit request' })).toBeEnabled()
  await dialog.getByRole('button', { name: 'Submit request' }).click()
}

test('submits a new request and exposes only the safe GitHub issue link', async ({ page }) => {
  await stubTurnstile(page)
  await page.route('**/api/exam-requests', async (route) => {
    const body = route.request().postDataJSON() as Record<string, string>
    expect(body).toMatchObject({ examCode: 'AB-730', turnstileToken: 'official-test-token' })
    expect(body.idempotencyKey).toMatch(/^[0-9a-f-]{36}$/)
    await route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({ number: 73, url: issueUrl, reused: false, traceId: 'trace-new' }),
    })
  })

  await openReadyDialog(page)
  await selectExamAndSubmit(page)

  const successHeading = page.getByRole('heading', { name: 'Request created' })
  await expect(successHeading).toBeVisible()
  await expect(successHeading).toBeFocused()
  await expect(page.getByText('AB-730 — AI Business Professional')).toBeVisible()
  const issueLink = page.getByRole('link', { name: 'View GitHub issue #73 (opens in a new tab)' })
  await expect(issueLink).toHaveAttribute('href', issueUrl)
  await expect(issueLink).toHaveAttribute('rel', 'noreferrer')
  await expect(issueLink).toHaveAttribute('target', '_blank')
  await expectAccessibleTarget(issueLink)
})

test('shows the reused issue outcome', async ({ page }) => {
  await stubTurnstile(page)
  await page.route('**/api/exam-requests', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ number: 73, url: issueUrl, reused: true, traceId: 'trace-reused' }),
  }))

  await openReadyDialog(page)
  await selectExamAndSubmit(page)

  await expect(page.getByRole('heading', { name: 'Request already exists' })).toBeVisible()
  await expect(page.getByText('This exam already has an open request.')).toBeVisible()
})

test('keeps rate-limit guidance actionable and retains the request id on retry', async ({ page }) => {
  await stubTurnstile(page)
  const requestIds: string[] = []
  await page.route('**/api/exam-requests', async (route) => {
    requestIds.push((route.request().postDataJSON() as { idempotencyKey: string }).idempotencyKey)
    await route.fulfill({
      status: 429,
      headers: { 'retry-after': '90' },
      contentType: 'application/json',
      body: JSON.stringify({ error: { kind: 'rateLimited', retryable: true, traceId: 'trace-limit' } }),
    })
  })

  const dialog = await openReadyDialog(page)
  await selectExamAndSubmit(page)
  await expect(dialog.getByRole('alert')).toContainText('Try again in about 90 seconds')
  await expect(dialog.getByRole('button', { name: 'Try again' })).toBeEnabled()
  await dialog.getByRole('button', { name: 'Try again' }).click()
  await expect.poll(() => requestIds.length).toBe(2)
  expect(new Set(requestIds).size).toBe(1)
})

test('excludes AI-102 and AZ-204, announces filtering, and restores focus after Escape', async ({ page }) => {
  await stubTurnstile(page)
  await page.goto('/')
  const trigger = page.getByRole('button', { name: 'Can’t find your exam? Request it' })
  await trigger.focus()
  await trigger.press('Enter')

  const dialog = page.getByRole('dialog', { name: 'Request an exam' })
  const search = dialog.getByLabel('Search available exams')
  for (const supportedCode of ['AI-102', 'AZ-204']) {
    await search.fill(supportedCode)
    await expect(dialog.getByRole('radio', { name: new RegExp(supportedCode) })).toHaveCount(0)
    await expect(dialog.locator('.request-result-status')).toContainText('No requestable exams match your search.')
  }
  await search.fill('AB-730')
  await expect(dialog.locator('.request-result-status')).toContainText('1 requestable exam matches your search.')
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
  await expect(trigger).toBeFocused()
})

test('opens the same localized dialog from challenge entry', async ({ page }) => {
  await stubTurnstile(page)
  await page.goto('/')
  await page.getByRole('button', { name: /Live Challenge/ }).click()
  await page.getByRole('button', { name: 'Switch to French' }).click()
  await page.getByRole('button', { name: 'Examen introuvable ? Demandez-le' }).click()

  const dialog = page.getByRole('dialog', { name: 'Demander un examen' })
  await expect(dialog).toBeVisible()
  await expect(page.locator('html')).toHaveAttribute('lang', 'fr')
  await expect(dialog.locator('.turnstile-widget')).toHaveAttribute('data-rendered-language', 'fr')
  await expect(dialog.getByText('Aucun compte ni renseignement personnel n’est requis.')).toBeVisible()
  const sourceLink = dialog.getByRole('link', { name: 'Consulter la liste source (s’ouvre dans un nouvel onglet)' })
  await expect(sourceLink).toHaveAttribute('href', /learn\.microsoft\.com/)
  await expectAccessibleTarget(sourceLink)
})

test('uses realistic compact Turnstile dimensions when only narrow space is available', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 720 })
  await stubTurnstile(page)
  await page.goto('/')
  await page.getByRole('button', { name: 'Switch to French' }).click()
  await page.getByRole('button', { name: 'Examen introuvable ? Demandez-le' }).click()

  const dialog = page.getByRole('dialog', { name: 'Demander un examen' })
  await expect(dialog.getByRole('radio', { name: /AB-730/ })).toBeVisible()
  const turnstile = dialog.locator('.turnstile-widget')
  await expect(turnstile).toHaveAttribute('data-rendered-size', 'compact')
  const widgetBox = await turnstile.locator('div').boundingBox()
  expect(widgetBox?.width).toBe(150)
  expect(widgetBox?.height).toBe(140)
  expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false)
  for (const control of await dialog.locator('button:visible').all()) {
    const box = await control.boundingBox()
    expect(box?.height).toBeGreaterThanOrEqual(43.9)
    expect(box?.width).toBeGreaterThanOrEqual(43.9)
  }
})

test('shows a controlled error when Turnstile blocks verification', async ({ page }) => {
  await stubTurnstile(page)
  await page.goto('/?turnstile-test=block')
  await page.getByRole('button', { name: 'Can’t find your exam? Request it' }).click()
  const dialog = page.getByRole('dialog', { name: 'Request an exam' })
  await expect(dialog.locator('.turnstile-widget')).toHaveAttribute('data-rendered-sitekey', officialAlwaysBlockSiteKey)
  await expect(dialog.getByRole('alert')).toContainText('security check could not load')
  await expect(dialog.getByRole('button', { name: 'Submit request' })).toBeDisabled()
})

test('uses normal Turnstile dimensions and the active app theme when space permits', async ({ page }) => {
  await stubTurnstile(page)
  await page.goto('/')
  await page.getByRole('button', { name: 'Switch to dark mode' }).click()
  await page.getByRole('button', { name: 'Can’t find your exam? Request it' }).click()

  const turnstile = page.getByRole('dialog', { name: 'Request an exam' }).locator('.turnstile-widget')
  await expect(turnstile).toHaveAttribute('data-rendered-size', 'normal')
  await expect(turnstile).toHaveAttribute('data-rendered-theme', 'dark')
  await expect(turnstile).toHaveAttribute('data-rendered-language', 'en')
  const widgetBox = await turnstile.locator('div').boundingBox()
  expect(widgetBox?.width).toBe(300)
  expect(widgetBox?.height).toBe(65)
})

test('clears a selection as soon as filtering makes it invisible', async ({ page }) => {
  await stubTurnstile(page)
  const dialog = await openReadyDialog(page)
  await dialog.getByRole('radio', { name: /AB-730/ }).check()
  await expect(dialog.getByRole('button', { name: 'Submit request' })).toBeEnabled()

  await dialog.getByLabel('Search available exams').fill('DP-100')

  await expect(dialog.getByRole('radio', { name: /AB-730/ })).toHaveCount(0)
  await expect(dialog.getByRole('button', { name: 'Submit request' })).toBeDisabled()
})

test('makes the background inert and prevents edits or dismissal while submission is pending', async ({ page }) => {
  await stubTurnstile(page)
  let releaseResponse: (() => void) | undefined
  const responseGate = new Promise<void>((resolve) => { releaseResponse = resolve })
  await page.route('**/api/exam-requests', async (route) => {
    await responseGate
    await route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({ number: 73, url: issueUrl, reused: false, traceId: 'trace-pending' }),
    })
  })

  const dialog = await openReadyDialog(page)
  const appShell = page.locator('.app-shell')
  await expect(appShell).toHaveAttribute('inert', '')
  await expect(appShell).toHaveAttribute('aria-hidden', 'true')
  await selectExamAndSubmit(page)

  await expect(dialog.locator('form')).toHaveAttribute('aria-busy', 'true')
  await expect(dialog.getByLabel('Search available exams')).toBeDisabled()
  await expect(dialog.getByRole('radio', { name: /AB-730/ })).toBeDisabled()
  await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeDisabled()
  await expect(dialog.getByRole('button', { name: 'Close request dialog' })).toBeDisabled()
  await page.keyboard.press('Escape')
  await expect(dialog).toBeVisible()

  releaseResponse?.()
  await expect(page.getByRole('heading', { name: 'Request created' })).toBeFocused()
})
