import { expect, test } from '@playwright/test';

test('趋势展示用途，混算被拒绝时清除旧结果', async ({ page }) => {
  let mixed = false;
  await page.route('**/api/env/manifest', (route) => route.fulfill({ json: {} }));
  await page.route('**/api/runs/trend?**', (route) =>
    mixed
      ? route.fulfill({ status: 400, json: { error: '用途不可比：趋势包含不同用途' } })
      : route.fulfill({
          json: {
            purpose: 'regression',
            points: [{ run_id: 'trend-browser', dataset: 'test', value: 1 }],
          },
        }),
  );
  await page.goto('/');
  await page.locator('#navTrends').click();
  await expect(page.locator('#trendStatus')).toContainText('用途：regression');
  await expect(page.locator('#trendBody')).toContainText('trend-browser');
  mixed = true;
  await page.locator('#trendRefresh').click();
  await expect(page.locator('#trendStatus')).toContainText('用途不可比');
  await expect(page.locator('#trendTable')).toBeHidden();
  await expect(page.locator('#trendBody')).toBeEmpty();
});

test('任务用途必选、提交与回填，已有运行后禁止修改', async ({ page }) => {
  page.on('pageerror', (error) => {
    throw error;
  });
  let task: Record<string, unknown> | undefined;
  await page.route('**/api/env/manifest', async (route) => {
    await route.fulfill({ json: {} });
  });
  await page.route('**/api/eval-tasks', async (route) => {
    if (route.request().method() === 'POST') {
      const input = route.request().postDataJSON() as Record<string, unknown>;
      task = {
        ...input,
        id: 'et-browser',
        runs: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      await route.fulfill({ status: 201, json: task });
      return;
    }
    await route.fulfill({ json: { tasks: task ? [task] : [], errors: [] } });
  });
  await page.route('**/api/eval-tasks/et-browser', async (route) => {
    if (route.request().method() === 'PUT') {
      task = { ...task, ...(route.request().postDataJSON() as Record<string, unknown>) };
    }
    await route.fulfill({ json: task });
  });
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  await page.locator('#newEvalTask').click();
  await page.locator('#newEvalName').fill('浏览器用途回归');
  await page.locator('#newEvalSubmit').click();
  await expect(page.locator('#newEvalDialog')).toBeVisible();
  expect(task).toBeUndefined();
  await page.locator('#newEvalPurpose').selectOption('regression');
  await page.locator('#newEvalSubmit').click();
  await expect(page.locator('#evalName')).toHaveValue('浏览器用途回归');
  await expect(page.locator('#evalPurpose')).toHaveValue('regression');
  expect(task?.purpose).toBe('regression');
  task = { ...task, purposeLocked: true };
  await page.reload();
  await expect(page.locator('#evalPurpose')).toBeDisabled();
  await expect(page.locator('#evalPurpose')).toHaveValue('regression');
  for (const [navigation, panel] of [
    ['navBank', 'pageBank'],
    ['navEnv', 'pageEnv'],
    ['navTest', 'pageTest'],
  ]) {
    await page.locator(`#${navigation}`).click();
    await expect(page.locator(`#${panel}`)).toBeVisible();
  }
});
