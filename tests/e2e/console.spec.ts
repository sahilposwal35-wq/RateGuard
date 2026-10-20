import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const screenshotsDir = path.resolve(process.cwd(), 'docs/screenshots');

if (!fs.existsSync(screenshotsDir)) {
  fs.mkdirSync(screenshotsDir, { recursive: true });
}

test.describe('RateGuard Admin Console E2E', () => {
  test('1. Sign in with admin token and inspect overview', async ({ page }) => {
    await page.goto('/console/');

    // Should redirect or render signin form
    await expect(page.locator('h1')).toHaveText('Sign in');

    // Attempt sign in with invalid token
    await page.fill('#admin-token', 'wrong_token');
    await page.click('#signin-submit-btn');
    await expect(page.locator('#signin-error')).toBeVisible();

    // Sign in with valid admin token
    await page.fill('#admin-token', 'admin_secret_token_123');
    await page.click('#signin-submit-btn');

    // Should navigate to overview
    await expect(page).toHaveURL(/.*#overview/);
    await expect(page.locator('h1')).toHaveText('System overview');

    // Verify stats from API
    await expect(page.locator('#stat-redis')).toContainText('Connected', { timeout: 10000 });
    await expect(page.locator('#stat-pg')).toContainText('Connected');
    await expect(page.locator('#stat-degraded')).toContainText('Normal');
  });

  test('2. Plans and policies inspection and creation', async ({ page }) => {
    await page.goto('/console/#plans');

    // Sign in if redirected
    if (await page.locator('#admin-token').isVisible()) {
      await page.fill('#admin-token', 'admin_secret_token_123');
      await page.click('#signin-submit-btn');
      await page.waitForURL(/.*#overview/);
      await page.click('a[data-page="plans"]');
    }

    await expect(page.locator('h1')).toHaveText('Plans and policies');

    // Create a new test plan
    await page.click('#btn-show-create-plan');
    await expect(page.locator('.modal-dialog')).toBeVisible();

    const testPlanName = `E2E Plan ${Date.now()}`;
    await page.fill('#plan-name', testPlanName);
    await page.fill('#plan-quota-limit', '50000');
    await page.selectOption('#plan-quota-mode', 'write_behind');
    await page.click('#modal-submit-btn');

    // Verify plan appears in list
    await expect(page.locator('#plans-list')).toContainText(testPlanName, { timeout: 10000 });

    // Add a policy to this plan
    await page.click('#btn-show-create-policy');
    await expect(page.locator('.modal-dialog')).toBeVisible();

    await page.fill('#policy-route', 'GET /v1/e2e-items');
    await page.selectOption('#policy-algo', 'sliding_window');
    await page.fill('#policy-limit', '25');
    await page.fill('#policy-window', '60');
    await page.click('#modal-submit-btn');

    // Verify policy appears in table
    await expect(page.locator('#policies-table-body')).toContainText('GET /v1/e2e-items');
  });

  test('3. Clients and API keys lifecycle (create client, issue secret, copy key, revoke key)', async ({ page }) => {
    await page.goto('/console/#clients');

    // Sign in if needed
    if (await page.locator('#admin-token').isVisible()) {
      await page.fill('#admin-token', 'admin_secret_token_123');
      await page.click('#signin-submit-btn');
      await page.waitForURL(/.*#overview/);
      await page.click('a[data-page="clients"]');
    }

    await expect(page.locator('h1')).toHaveText('Clients and API keys');

    // Create client
    await page.click('#btn-show-create-client');
    await expect(page.locator('.modal-dialog')).toBeVisible();

    const clientName = `E2E Client ${Date.now()}`;
    await page.fill('#client-name', clientName);
    await page.click('#btn-submit-client');

    // Verify client in list and selected
    await expect(page.locator('#clients-list')).toContainText(clientName, { timeout: 10000 });

    // Issue API key
    await page.click('#btn-issue-key');
    await expect(page.locator('.modal-dialog')).toBeVisible();
    await expect(page.locator('.modal-header h3')).toHaveText('API key issued');
    await expect(page.locator('.notice-warn')).toContainText('Store this secret safely. You cannot retrieve it again.');

    const issuedKey = await page.inputValue('#issued-key-input');
    expect(issuedKey).toBeTruthy();
    expect(issuedKey.length).toBeGreaterThan(10);

    // Click copy button
    await page.click('#btn-copy-key');
    await expect(page.locator('#btn-copy-key')).toHaveText('Copied');

    // Close issued modal
    await page.click('#btn-close-issued');

    // Verify key listed in table as active
    await expect(page.locator('#keys-table-body')).toContainText('active');

    // Revoke key with confirmation dialog
    await page.click('.btn-revoke-key');
    await expect(page.locator('.modal-dialog')).toBeVisible();
    await expect(page.locator('.modal-header h3')).toHaveText('Revoke API key');
    await expect(page.locator('.modal-body p')).toContainText('Are you sure you want to revoke API key');

    await page.click('#btn-confirm-revoke');
    await expect(page.locator('#keys-table-body')).toContainText('revoked');
  });

  test('4. Test playground (burst execution and live inspection)', async ({ page }) => {
    // First, issue a valid key via API to use in playground
    await page.goto('/console/#clients');
    if (await page.locator('#admin-token').isVisible()) {
      await page.fill('#admin-token', 'admin_secret_token_123');
      await page.click('#signin-submit-btn');
      await page.waitForURL(/.*#overview/);
      await page.click('a[data-page="clients"]');
    }

    // Issue a fresh key
    await page.click('#btn-issue-key');
    await page.waitForSelector('#issued-key-input');
    const freshApiKey = await page.inputValue('#issued-key-input');
    await page.click('#btn-close-issued');

    // Navigate to playground
    await page.click('a[data-page="playground"]');
    await expect(page.locator('h1')).toHaveText('Test playground');

    // Enter api key and parameters
    await page.fill('#playground-api-key', freshApiKey);
    await page.fill('#playground-route', 'GET /v1/items');
    await page.fill('#playground-cost', '1');

    // Send single check
    await page.click('#btn-send-single');
    await expect(page.locator('#summary-line-container')).toContainText('200 allowed', { timeout: 10000 });
    await expect(page.locator('#raw-response-box')).toContainText('"allowed": true');

    // Send burst of 10 requests
    await page.fill('#burst-count', '10');
    await page.click('#btn-send-burst');

    await expect(page.locator('#burst-panel')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('#burst-table-body tr')).toHaveCount(10);
  });

  test('5. Global bypass toggle with confirmation dialog', async ({ page }) => {
    await page.goto('/console/#settings');
    if (await page.locator('#admin-token').isVisible()) {
      await page.fill('#admin-token', 'admin_secret_token_123');
      await page.click('#signin-submit-btn');
      await page.waitForURL(/.*#overview/);
      await page.click('a[data-page="settings"]');
    }

    await expect(page.locator('h1')).toHaveText('Settings');
    await expect(page.locator('#stat-config-version')).toContainText('v');
    await expect(page.locator('#stat-poll-interval')).toHaveText('1000 ms');

    // Toggle bypass
    await page.click('#btn-toggle-bypass');
    await expect(page.locator('.modal-dialog')).toBeVisible();
    await expect(page.locator('.modal-header h3')).toContainText('bypass');

    // Cancel modal first to verify cancellation
    await page.click('#btn-cancel-bypass');
    await expect(page.locator('.modal-dialog')).not.toBeVisible();

    // Toggle and confirm
    await page.click('#btn-toggle-bypass');
    await page.click('#btn-confirm-bypass');

    // Status text should update
    await expect(page.locator('#settings-feedback')).toContainText('Global bypass', { timeout: 10000 });

    // Restore bypass to inactive
    await page.click('#btn-toggle-bypass');
    await page.click('#btn-confirm-bypass');
    await expect(page.locator('#bypass-status-text')).toContainText('Inactive');
  });

  test('6. Capture responsive screenshots across viewports', async ({ page }) => {
    const viewports = [
      { name: '1280px', width: 1280, height: 800 },
      { name: '1024px', width: 1024, height: 768 },
      { name: '768px', width: 768, height: 1024 },
    ];

    for (const vp of viewports) {
      await page.setViewportSize({ width: vp.width, height: vp.height });

      // Sign in if needed
      await page.goto('/console/#overview');
      if (await page.locator('#admin-token').isVisible()) {
        await page.fill('#admin-token', 'admin_secret_token_123');
        await page.click('#signin-submit-btn');
        await page.waitForURL(/.*#overview/);
      }

      // Wait for overview load
      await page.waitForSelector('#stat-redis');
      await page.screenshot({
        path: path.join(screenshotsDir, `overview-${vp.name}.png`),
        fullPage: true,
      });

      // Plans screenshot
      await page.click('a[data-page="plans"]');
      await page.waitForSelector('#plans-list');
      await page.screenshot({
        path: path.join(screenshotsDir, `plans-${vp.name}.png`),
        fullPage: true,
      });

      // Clients screenshot
      await page.click('a[data-page="clients"]');
      await page.waitForSelector('#clients-list');
      await page.screenshot({
        path: path.join(screenshotsDir, `clients-${vp.name}.png`),
        fullPage: true,
      });

      // Playground screenshot
      await page.click('a[data-page="playground"]');
      await page.waitForSelector('#playground-form');
      await page.screenshot({
        path: path.join(screenshotsDir, `playground-${vp.name}.png`),
        fullPage: true,
      });

      // Settings screenshot
      await page.click('a[data-page="settings"]');
      await page.waitForSelector('#stat-config-version');
      await page.screenshot({
        path: path.join(screenshotsDir, `settings-${vp.name}.png`),
        fullPage: true,
      });
    }
  });
});
