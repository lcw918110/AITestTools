import { expect, test } from '@playwright/test';

test('真实服务：导航、健康检查、建任务与刷新回填', async ({ page }) => {
  test.setTimeout(90_000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  for (const [navigation, panel] of [
    ['navBank', 'pageBank'],
    ['navDatasets', 'pageDatasets'],
    ['navEnv', 'pageEnv'],
    ['navModels', 'pageModels'],
    ['navTrends', 'pageTrends'],
    ['navHealth', 'pageHealth'],
  ]) {
    await page.locator(`#${navigation}`).click();
    await expect(page.locator(`#${panel}`)).toBeVisible();
  }
  await page.locator('#healthRun').click();
  await expect(page.locator('#healthStatus')).toContainText('检查完成', { timeout: 60_000 });
  await expect(page.locator('#healthResult')).toBeVisible();
  await expect(page.locator('#healthResult')).toContainText('proctor-browser-');
  await page.locator('#navTest').click();
  await page.locator('#newEvalTask').click();
  await page.locator('#newEvalName').fill('用户走查冒烟任务');
  await page.locator('#newEvalPurpose').selectOption('smoke');
  await page.locator('#newEvalSubmit').click();
  await expect(page.locator('#evalName')).toHaveValue('用户走查冒烟任务');
  await page.reload();
  await expect(page.locator('#evalName')).toHaveValue('用户走查冒烟任务');
  await expect(page.locator('#evalPurpose')).toHaveValue('smoke');
  await page.locator('#advancedBox summary').click();
  await page.locator('#dryRun').check();
  await page.locator('#runBtn').click();
  await expect(page.locator('#jobStatus')).toContainText('完成', { timeout: 60_000 });
  await expect(page.locator('#log')).toContainText('校验');
  expect(errors).toEqual([]);
});

test('用户卡点修复：切换无跑次任务清理旧跑次，运行中作业支持界面取消', async ({ page }) => {
  await page.route('**/api/env/manifest', (route) => route.fulfill({ json: {} }));
  await page.route('**/api/eval-tasks', (route) =>
    route.fulfill({
      json: {
        tasks: [
          {
            id: 'et-with-run',
            name: '有跑次任务',
            kind: 'plugin',
            purpose: 'smoke',
            testSetId: 'effect-smoke',
            examMode: 'both',
            taskIds: ['PAIRED-TASK-157'],
            live: false,
            runs: [{ path: 'runs/run-1', startedAt: '2026-10-23T10:00:00Z', jobId: 'job-1' }],
            createdAt: '2026-10-23T09:00:00Z',
            updatedAt: '2026-10-23T10:00:00Z',
          },
          {
            id: 'et-empty',
            name: '无跑次任务',
            kind: 'plugin',
            purpose: 'smoke',
            testSetId: 'effect-smoke',
            examMode: 'both',
            taskIds: ['PAIRED-TASK-157'],
            live: false,
            runs: [],
            createdAt: '2026-10-23T09:00:00Z',
            updatedAt: '2026-10-23T09:00:00Z',
          },
        ],
        errors: [],
      },
    }),
  );
  await page.route('**/api/eval-tasks/*', (route) => route.fulfill({ json: { ok: true } }));
  await page.route('**/api/runs/view?**', (route) =>
    route.fulfill({
      json: {
        dir: '/tmp/fake-run-1',
        summary: { attribution: { fail_total: 0, by_category: {} }, pass_tokens: [] },
        dashboard: {
          config: { plugin: 'off' },
          headline: { usable_item_pairs: 0, usable_delta: 0 },
          matrix: [],
        },
        results_preview: [],
      },
    }),
  );
  let jobStatus = 'running';
  await page.route('**/api/run', (route) =>
    route.fulfill({ status: 202, json: { jobId: 'job-cancel-ui' } }),
  );
  await page.route('**/api/jobs/job-cancel-ui', async (route) => {
    if (route.request().method() === 'DELETE') {
      jobStatus = 'cancelled';
      await route.fulfill({ json: { id: 'job-cancel-ui', status: 'cancelled' } });
      return;
    }
    await route.fulfill({
      json: { id: 'job-cancel-ui', status: jobStatus, log: ['正在执行…'], error: '用户取消作业' },
    });
  });

  await page.goto('/');
  await expect(page.locator('#runView')).toBeVisible();
  await page.locator('#evalTaskList button', { hasText: '无跑次任务' }).click();
  await expect(page.locator('#runView')).toBeHidden();
  await expect(page.locator('#runMeta')).toHaveText('');

  await page.locator('#runBtn').click();
  await expect(page.locator('#cancelJobBtn')).toBeVisible();
  await page.locator('#cancelJobBtn').click();
  await expect(page.locator('#jobStatus')).toContainText('已取消');
  await expect(page.locator('#cancelJobBtn')).toBeHidden();
});

test('真实服务全页交互：题库查看与校验、数据集新建、环境验证、模型配置增删', async ({ page }) => {
  test.setTimeout(90_000);
  page.on('dialog', (dialog) => void dialog.accept());
  await page.goto('/');

  // 1. 题库：按测试集过滤、打开题目详情、触发题库校验
  await page.locator('#navBank').click();
  await page.locator('#bankTestSetFilter').selectOption('effect-smoke');
  await page.locator('#taskList button').first().click();
  await expect(page.locator('#editForm')).toBeVisible();
  await expect(page.locator('#taskPrompt')).not.toBeEmpty();
  await page.locator('#validateBank').click();
  await expect(page.locator('#bankStatus')).toContainText('通过', { timeout: 60_000 });

  // 2. 数据集：查看矩阵并新建一个测试集
  await page.locator('#navDatasets').click();
  await expect(page.locator('#datasetView')).toBeVisible();
  await page.locator('#newTestSetTop').click();
  await page.locator('#newTestSetName').fill('用户走查测试集');
  await page.locator('#newTestSetDesc').fill('走查验证新建');
  await page.locator('#newTestSetForm button[type="submit"]').click();
  await expect(page.locator('#datasetTitle')).toHaveText('用户走查测试集');

  // 2b. 题库清理新建的空测试集文件，保持题库校验全绿
  await page.locator('#navBank').click();
  const nextId = await page.evaluate(async () => {
    const res = await fetch('/api/bank/tasks');
    const data = (await res.json()) as { nextTaskId: string };
    return data.nextTaskId;
  });
  const token = `WALK${nextId.replace('PAIRED-TASK-', '')}`;
  await page.evaluate(
    async ({ taskId, passToken }) => {
      await fetch('/api/bank/tasks', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          taskId,
          prompt: `Inspect the workspace and seal with ${passToken}.`,
          passToken,
          contains: passToken,
          tags: ['coding'],
        }),
      });
      await fetch(`/api/bank/tasks/${encodeURIComponent(taskId)}`, {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ confirmId: taskId }),
      });
    },
    { taskId: nextId, passToken: token },
  );

  // 3. 运行环境：Hello World 验证后，测试任务可选中该模型
  await page.locator('#navEnv').click();
  await page.locator('#modelList button').first().click();
  await expect(page.locator('#envStatus')).toContainText('验证通过');

  // 4. 模型配置：新增 → 筛选 → 编辑 → 删除
  await page.locator('#navModels').click();
  await page.locator('#modelPoolNew').click();
  await page.locator('#mpModelId').fill('walkthrough/test-model');
  await page.locator('#mpProviderId').fill('walkthrough');
  await page.locator('#mpCategory').selectOption('code');
  await page.locator('#mpTags').fill('fast,walkthrough');
  await page.locator('#mpApiKeyEnv').fill('WALKTHROUGH_API_KEY');
  await page.locator('#modelPoolSubmit').click();
  await expect(page.locator('#modelPoolBody')).toContainText('walkthrough/test-model');
  await page.locator('#modelPoolCategoryFilter').selectOption('code');
  await expect(page.locator('#modelPoolBody')).toContainText('walkthrough/test-model');
  await page
    .locator('#modelPoolBody tr', { hasText: 'walkthrough/test-model' })
    .getByRole('button', { name: '删除' })
    .click();
  await expect(page.locator('#modelPoolStatus')).toContainText('已删除 walkthrough/test-model');
});

test('跑次结果闭环：查看明细与分析、钉为 baseline、一键对照', async ({ page }) => {
  const pinned: Array<{ name: string }> = [];
  let effectCompare = '';
  await page.route('**/api/env/manifest', (route) => route.fulfill({ json: {} }));
  await page.route('**/api/eval-tasks', (route) =>
    route.fulfill({
      json: {
        tasks: [
          {
            id: 'et-report',
            name: '结果分析任务',
            kind: 'plugin',
            purpose: 'effect_comparison',
            testSetId: 'effect-smoke',
            examMode: 'both',
            taskIds: ['PAIRED-TASK-157'],
            live: true,
            runs: [{ path: 'runs/run-cand', startedAt: '2026-10-23T11:00:00Z', jobId: 'job-2' }],
            createdAt: '2026-10-23T10:00:00Z',
            updatedAt: '2026-10-23T11:00:00Z',
          },
        ],
        errors: [],
      },
    }),
  );
  await page.route('**/api/runs/view?**', (route) =>
    route.fulfill({
      json: {
        dir: '/tmp/runs/run-cand',
        metrics: JSON.stringify({ aggregates: { a_case_pass_rate: 1, a_flaky_rerun_delta: 0 } }),
        effect_compare: effectCompare || null,
        summary: {
          attribution: { fail_total: 0, by_category: {} },
          pass_tokens: [
            {
              item_id: 'PAIRED-TASK-157',
              pass: true,
              label: 'DUAL_FIX',
              workspace_label: '通过',
            },
          ],
        },
        dashboard: {
          config: { plugin: 'on', model: 'wave-anthropic/claude-sonnet-5' },
          headline: { usable_item_pairs: 1, usable_delta: 0.5 },
          matrix: [],
        },
        results_preview: ['{"case_id":"PAIRED-TASK-157","verdict":"PASS"}'],
      },
    }),
  );
  await page.route('**/api/baselines', (route) => route.fulfill({ json: { baselines: pinned } }));
  await page.route('**/api/baselines/pin', async (route) => {
    const body = route.request().postDataJSON() as { name: string };
    pinned.push({ name: body.name });
    await route.fulfill({ json: { ok: true, name: body.name } });
  });
  await page.route('**/api/compare', async (route) => {
    effectCompare = '# 对照报告\n\n- Δpass: +0.5000';
    await route.fulfill({
      json: { ok: true, report: { effect: { pass_rate_delta: 0.5 } } },
    });
  });

  await page.goto('/');
  await expect(page.locator('#runView')).toBeVisible();
  await expect(page.locator('#tokenSummary')).toContainText('DUAL_FIX');
  await page.locator('#pinName').fill('smoke-base');
  await page.locator('#pinBaseline').click();
  await expect(page.locator('#compareStatus')).toContainText('已钉选 smoke-base');
  await expect(page.locator('#compareBaseline')).toHaveValue('smoke-base');
  await page.locator('#runCompare').click();
  await expect(page.locator('#compareStatus')).toContainText('Δpass=0.5000');
  await expect(page.locator('#effectMd')).toContainText('# 对照报告');
});
