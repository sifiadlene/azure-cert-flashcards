import { expect, test } from '@playwright/test'

const examOption = 'GH-300 — GitHub Copilot (100 questions)'

for (const viewport of [
  { name: 'mobile', width: 320, height: 720 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'desktop', width: 1440, height: 900 },
]) {
  test(`${viewport.name} layout supports the practice flow without horizontal overflow`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height })
    await page.goto('/')

    const hasHorizontalOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    )
    expect(hasHorizontalOverflow).toBe(false)

    for (const control of await page.locator('button:visible').all()) {
      const box = await control.boundingBox()
      expect(box?.height).toBeGreaterThanOrEqual(43.9)
      expect(box?.width).toBeGreaterThanOrEqual(43.9)
    }

    await page.getByLabel('Exam').selectOption({ label: examOption })
    await page.getByLabel('Number of questions').selectOption('10')
    await page.getByRole('button', { name: 'Start Session' }).click()
    await page.locator('.option-card').first().click()
    await page.getByRole('button', { name: 'Check Answer' }).click()

    await expect(page.locator('.answer-reveal')).toBeVisible()
    expect(await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    )).toBe(false)
  })
}

test('French setup reflows on a mobile viewport', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 720 })
  await page.goto('/')
  await page.getByRole('button', { name: 'Switch to French' }).click()
  await page.getByLabel('Examen').selectOption({ label: examOption })

  await expect(page.getByRole('radio', { name: 'Quiz chronométré' })).toBeVisible()
  expect(await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  )).toBe(false)
})
