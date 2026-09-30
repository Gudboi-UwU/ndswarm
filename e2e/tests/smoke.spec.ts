import fs from 'node:fs'
import { expect, test } from '@playwright/test'

// The first-run path a new user takes with `docker compose up`: create the admin, open the
// demo, run it for 15 seconds, and read the results.
test('setup, run the demo, read results', async ({ page }) => {
  await page.goto('/')
  await expect(page).toHaveURL(/\/setup$/)
  await page.getByLabel('Username').fill('admin')
  await page.getByLabel('Password').fill('e2e-password')
  await page.getByRole('button', { name: 'Create admin' }).click()
  await expect(page.getByText('Load test an API in three steps')).toBeVisible()

  // Big to small: projects, then the project's tests.
  await page.getByRole('link', { name: 'Projects', exact: true }).click()
  await page.getByRole('link', { name: 'Demo shop' }).click()
  await page.getByRole('link', { name: 'Browse and checkout' }).click()
  await expect(page.getByRole('list', { name: 'Requests' }).getByRole('listitem')).toHaveCount(5)

  // Shorten the demo to 15 seconds with the simple load form; Run test saves first.
  await page.getByRole('tab', { name: 'Load' }).click()
  await page.getByLabel('Test length').fill('15')
  await expect(page.getByText(/Total 15 seconds/)).toBeVisible()

  await page.getByRole('button', { name: 'Run test' }).click()
  // The flaky endpoint may fail its single preflight request (5%); that is only a warning.
  const anyway = page.getByRole('button', { name: 'Run anyway' })
  await Promise.race([page.waitForURL(/\/runs\/\d+$/), anyway.waitFor().then(() => anyway.click())])
  await expect(page).toHaveURL(/\/runs\/\d+$/)
  const runId = page.url().split('/').pop()

  const totals = page.getByRole('region', { name: 'Totals' })
  await expect(totals.getByText('Requests per second')).toBeVisible()
  await expect(totals.locator('p.font-mono').first()).not.toHaveText('-', { timeout: 10_000 })
  // No pass/fail rules are set on the demo test, so a clean run shows "Finished", not "Passed".
  await expect(page.getByText('Finished', { exact: true })).toBeVisible({ timeout: 40_000 })
  await expect(page.getByText(/^Finished, /)).toBeVisible()

  await page.getByRole('tab', { name: 'Details' }).click()
  await expect(page.getByRole('cell', { name: /0:00 to 0:10/ })).toBeVisible()
  await page.getByRole('radio', { name: 'Custom' }).click()
  await page.getByLabel('Custom interval unit').selectOption('1')
  await page.getByLabel('Custom interval', { exact: true }).fill('15')
  await expect(page.getByRole('cell', { name: /0:00 to 0:15/ })).toBeVisible()
  await expect(page.getByRole('columnheader', { name: '200' })).toBeVisible()

  await page.getByRole('tab', { name: 'Request log' }).click()
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

// A pass/fail rule that no real response can meet must fail the run and say so, on both the
// run page and the runs list.
test('a broken pass/fail rule fails the run', async ({ page }) => {
  await page.goto('/login')
  await page.getByLabel('Username').fill('admin')
  await page.getByLabel('Password').fill('e2e-password')
  await page.getByRole('button', { name: 'Log in' }).click()
  await expect(page).not.toHaveURL(/\/login$/)

  await page.goto('/projects')
  await page.getByRole('link', { name: 'Demo shop' }).click()
  await page.getByRole('link', { name: 'Browse and checkout' }).click()
  await page.getByRole('tab', { name: 'Load' }).click()

  // Impossible: no real response is under 0.001 ms.
  await page.getByRole('button', { name: 'Add rule' }).click()
  await page.getByLabel('Rule 1 metric').click()
  await page.getByRole('option', { name: 'Average response time (ms)' }).click()
  await page.getByLabel('Rule 1 comparison').click()
  await page.getByRole('option', { name: 'below', exact: true }).click()
  await page.getByLabel('Rule 1 value').fill('0.001')
  await expect(page.getByText(/average response time is below/)).toBeVisible()

  await page.getByRole('button', { name: 'Run test' }).click()
  const anyway = page.getByRole('button', { name: 'Run anyway' })
  await Promise.race([page.waitForURL(/\/runs\/\d+$/), anyway.waitFor().then(() => anyway.click())])
  await expect(page).toHaveURL(/\/runs\/\d+$/)

  // The verdict badge, not the endpoint table's "Failed" column header.
  const verdictBadge = page.locator('[title="A pass/fail rule of this test was broken."]')
  await expect(verdictBadge).toBeVisible({ timeout: 40_000 })
  await expect(page.getByText('Failed: 1 of 1 rule broken')).toBeVisible()
  await expect(page.getByText(/average response time is below.*actual/)).toBeVisible()

  await page.getByRole('link', { name: 'Runs', exact: true }).click()
  const row = page.getByRole('row').filter({ hasText: 'Browse and checkout' }).first()
  await expect(row).toBeVisible()
  await expect(row.locator('[title="A pass/fail rule of this test was broken."]')).toBeVisible()
})

// counts leaf (non-folder) items in a Postman collection, recursively.
function countRequests(items: { item?: unknown[]; request?: unknown }[]): number {
  return items.reduce((n, it) => n + (it.request ? 1 : countRequests((it.item as typeof items) ?? [])), 0)
}

// Import a Postman collection into a new project, check what landed, export it back out as a
// Postman collection, and confirm re-importing that export finds the same requests.
test('import a Postman collection and export it back out', async ({ page }) => {
  await page.goto('/')
  await expect(page).toHaveURL(/\/login$/)
  await page.getByLabel('Username').fill('admin')
  await page.getByLabel('Password').fill('e2e-password')
  await page.getByRole('button', { name: 'Log in' }).click()
  await expect(page).not.toHaveURL(/\/login$/)

  await page.goto('/projects')
  await page.getByRole('button', { name: 'Import' }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByText('Import tests')).toBeVisible()

  await dialog.locator('input[type="file"]:not([aria-label])').setInputFiles('fixtures/shop.postman_collection.json')
  await dialog.getByRole('button', { name: 'Next' }).click()

  // Preview: format, tests and their request counts, warnings.
  await expect(dialog.getByText(/Found a Postman collection with 3 tests and 9 requests/)).toBeVisible()
  // Each test is a <summary> line "<name> <n> requests"; scope to those so "Shop API" (also the
  // server name) and "Auth" (also a request URL) don't match elsewhere in the dialog.
  const summaries = dialog.locator('summary')
  await expect(summaries.filter({ hasText: 'Auth' })).toContainText('2 requests')
  await expect(summaries.filter({ hasText: 'Orders' })).toContainText('6 requests')
  await expect(summaries.filter({ hasText: 'Shop API' })).toContainText('1 request')
  await expect(dialog.getByText(/5 things could not be imported exactly/)).toBeVisible()

  await dialog.getByRole('button', { name: 'Import 3 tests' }).click()
  await expect(page).toHaveURL(/\/projects\/\d+$/)
  const projectUrl = page.url()

  await expect(page.getByRole('link', { name: 'Auth', exact: true })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Orders', exact: true })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Shop API', exact: true })).toBeVisible()

  await page.getByRole('link', { name: 'Orders', exact: true }).click()
  await expect(page.getByRole('list', { name: 'Requests' }).getByRole('listitem')).toHaveCount(6)

  await page.goto(projectUrl)
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export' }).click()
  await page.getByRole('menuitem', { name: 'Postman collection' }).click()
  const file = await download
  const path = await file.path()
  const text = fs.readFileSync(path!, 'utf8')
  const collection = JSON.parse(text)
  expect(collection.info.schema).toContain('v2.1.0')
  expect(countRequests(collection.item)).toBe(9)

  // Re-import that exported file (via the API, no need to drive the file input again) and confirm
  // it round-trips to the same 9 requests.
  const preview = await page.request.post('/api/v1/import/preview', {
    headers: { 'X-Requested-With': 'ndswarm', 'Content-Type': 'application/json' },
    data: { content: text },
  })
  expect(preview.ok()).toBe(true)
  const body = await preview.json()
  const requestTotal = (body.tests as { requests: unknown[] }[]).reduce((n, t) => n + t.requests.length, 0)
  expect(requestTotal).toBe(9)
})
