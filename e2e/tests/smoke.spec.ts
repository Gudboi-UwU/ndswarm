import { expect, test } from '@playwright/test'

// The first-run path a new user takes with `docker compose up`: create the admin, open the
// demo, run it for 15 seconds, and read the results.
test('setup, run the demo, read results', async ({ page }) => {
  await page.goto('/')
  await expect(page).toHaveURL(/\/setup$/)
  await page.getByLabel('Username').fill('admin')
  await page.getByLabel('Password').fill('e2e-password')
  await page.getByRole('button', { name: 'Create admin' }).click()
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible()

  await page.getByRole('link', { name: 'Projects', exact: true }).click()
  await page.getByRole('link', { name: 'Demo shop', exact: true }).click()
  await page.getByRole('link', { name: 'Browse and checkout' }).click()
  await expect(page.getByRole('list', { name: 'Endpoints' }).getByRole('listitem')).toHaveCount(5)

  // Shorten the demo to 15 seconds: 5 s ramp + 10 s hold.
  await page.getByRole('tab', { name: 'Load' }).click()
  await page.getByLabel('Stage 2 duration').fill('10')
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(page.getByText('Test saved')).toBeVisible()

  await page.getByRole('button', { name: 'Start', exact: true }).click()
  // The flaky endpoint may fail its single preflight request (5%); that is only a warning.
  const anyway = page.getByRole('button', { name: 'Start anyway' })
  await Promise.race([page.waitForURL(/\/runs\/\d+$/), anyway.waitFor().then(() => anyway.click())])
  await expect(page).toHaveURL(/\/runs\/\d+$/)
  const runId = page.url().split('/').pop()

  const totals = page.getByRole('region', { name: 'Totals' })
  await expect(totals.getByText('Requests/s')).toBeVisible()
  await expect(totals.locator('p.font-mono').nth(3)).not.toHaveText('-', { timeout: 10_000 })
  await expect(page.getByText('Passed', { exact: true })).toBeVisible({ timeout: 40_000 })
  const requests = Number((await totals.locator('p.font-mono').nth(1).innerText()).replace(/,/g, ''))
  expect(requests).toBeGreaterThan(100)

  await page.getByRole('tab', { name: 'Summary' }).click()
  await expect(page.getByRole('cell', { name: /0:00 to 0:10/ })).toBeVisible()
  await expect(page.getByRole('columnheader', { name: '200' })).toBeVisible()

  await page.getByRole('tab', { name: 'Logs' }).click()
  const rows = page.getByRole('table').getByRole('row')
  await expect(rows.nth(1)).toBeVisible()
  await rows.nth(1).click()
  await expect(page.getByRole('dialog').getByRole('tab', { name: 'Response' })).toBeVisible()
  await page.keyboard.press('Escape')

  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export' }).click()
  await page.getByRole('menuitem', { name: 'CSV' }).first().click()
  const file = await download
  expect(file.suggestedFilename()).toBe(`run-${runId}-summary.csv`)
  const csv = await (await file.createReadStream()).toArray()
  expect(Buffer.concat(csv).toString()).toContain('endpoint,requests,ok,errors')
})
