import { expect, test } from '@playwright/test';

test('create a container, reload, find it again', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'MiniGIS Brenzikofen' })).toBeVisible();
  await expect(page.getByText('Umwelt')).toBeVisible();

  // Enable editing on the layer (also switches it on).
  await page.getByText('Abfallcontainer').locator('xpath=ancestor::li[1]').getByRole('button', { name: '✎' }).click();
  await page.getByRole('button', { name: 'Neu', exact: true }).click();

  // The right panel opens after drawing and shrinks the map, so work out the click pixel now.
  const map = page.locator('main.map');
  await expect(map).toBeVisible();
  const box = (await map.boundingBox())!;
  const centre = { x: Math.round(box.width / 2), y: Math.round(box.height / 2) };
  await map.click({ position: centre });

  await page.getByLabel('Nummer').fill('E2E-1');
  const saved = page.waitForResponse((r) => r.request().method() === 'POST' && r.url().includes('/api/layers/abfallcontainer/features'));
  await page.getByRole('button', { name: 'Speichern' }).click();
  expect((await saved).status()).toBe(201);

  // After a reload nothing is selected and the layer is off; the panel is closed so the map has its full size.
  const features = page.waitForResponse((r) => r.url().includes('/api/layers/abfallcontainer/features') && r.request().method() === 'GET');
  await page.reload();
  await expect(page.getByRole('heading', { name: 'MiniGIS Brenzikofen' })).toBeVisible();
  await page.getByLabel('Abfallcontainer').check();
  await features;
  await expect(page.locator('aside.panel')).toHaveCount(0);

  await map.click({ position: centre });
  await expect(page.locator('aside.panel')).toContainText('E2E-1');
});
