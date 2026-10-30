import { expect, test } from '@playwright/test';

test.describe('控制台核心页面端到端交互测试 (GAP-3, ISSUE-0003)', () => {
  test.beforeEach(async ({ page }) => {
    page.on('pageerror', (error) => {
      throw error;
    });
  });

  test.describe('题库管理交互 (Bank)', () => {
    test('题库列表加载、测试集过滤筛选与题目详情查看', async ({ page }) => {
      await page.route('**/api/env/manifest', (route) => route.fulfill({ json: {} }));
      await page.route('**/api/test-sets', (route) =>
        route.fulfill({
          json: {
            testSets: [
              { id: 'set-a', label: '基础测试集 A', taskIds: ['PAIRED-TASK-01'] },
              { id: 'set-b', label: '扩展测试集 B', taskIds: ['PAIRED-TASK-02'] },
            ],
          },
        }),
      );
      await page.route('**/api/bank/tasks', (route) =>
        route.fulfill({
          json: {
            tasks: [
              {
                taskId: 'PAIRED-TASK-01',
                passToken: 'TOKEN_ALPHA',
                tags: ['coding'],
                complete: true,
                versionLabel: 'v1.0.0',
                testSetIds: ['set-a'],
              },
              {
                taskId: 'PAIRED-TASK-02',
                passToken: 'TOKEN_BETA',
                tags: ['refactor'],
                complete: false,
                versionLabel: 'v0.9.0',
                testSetIds: ['set-b'],
              },
            ],
            nextTaskId: 'PAIRED-TASK-03',
          },
        }),
      );
      await page.route('**/api/bank/tasks/PAIRED-TASK-01', (route) =>
        route.fulfill({
          json: {
            taskId: 'PAIRED-TASK-01',
            versionLabel: 'v1.0.0',
            prompt: '请输出 TOKEN_ALPHA 并实现功能',
            passToken: 'TOKEN_ALPHA',
            tags: ['coding'],
            notes: '备注说明 A',
            contains: 'TOKEN_ALPHA',
            notContains: 'ERROR',
            strata: { task_type: 'coding', difficulty_level: 'L2' },
            automationReadiness: 'ready_automated',
            lifecycle: 'active',
            lifecycleHistory: [
              { from: 'draft', to: 'active', reason: '审核通过', at: '2026-10-20' },
            ],
            rubric: {
              dimensions: [{ name: '正确性', scale: '0-5', weight: 1.0 }],
            },
            offId: 'EVAL-B-01-OFF',
            onId: 'EVAL-B-01-ON',
            complete: true,
          },
        }),
      );

      await page.goto('/#bank');
      await expect(page.locator('#pageBank')).toBeVisible();

      // 验证未选中时的空态占位
      await expect(page.locator('#editEmpty')).toBeVisible();
      await expect(page.locator('#editForm')).toBeHidden();

      // 验证列表包含两道题
      const taskButtons = page.locator('#taskList button');
      await expect(taskButtons).toHaveCount(2);
      await expect(taskButtons.nth(0)).toContainText('PAIRED-TASK-01');
      await expect(taskButtons.nth(1)).toContainText('PAIRED-TASK-02');
      // PAIRED-TASK-02 不完整，应有 warn 类名
      await expect(taskButtons.nth(1)).toHaveClass(/warn/);

      // 下拉过滤测试集：选择 "扩展测试集 B"
      await page.locator('#bankTestSetFilter').selectOption('set-b');
      await expect(page.locator('#taskList button')).toHaveCount(1);
      await expect(page.locator('#taskList button').first()).toContainText('PAIRED-TASK-02');

      // 切回全部
      await page.locator('#bankTestSetFilter').selectOption('');
      await expect(page.locator('#taskList button')).toHaveCount(2);

      // 点击第一题加载详情
      await taskButtons.first().click();
      await expect(page.locator('#editEmpty')).toBeHidden();
      await expect(page.locator('#editForm')).toBeVisible();

      // 断言详情字段正常回填
      await expect(page.locator('#taskTitle')).toHaveText('PAIRED-TASK-01');
      await expect(page.locator('#taskVersion')).toHaveText('v1.0.0');
      await expect(page.locator('#taskPrompt')).toHaveValue('请输出 TOKEN_ALPHA 并实现功能');
      await expect(page.locator('#taskToken')).toHaveValue('TOKEN_ALPHA');
      await expect(page.locator('#taskStrataType')).toHaveValue('coding');
      await expect(page.locator('#taskStrataDifficulty')).toHaveValue('L2');
      await expect(page.locator('#taskReadiness')).toHaveValue('ready_automated');
      await expect(page.locator('#taskLifecycle')).toHaveText('active');
      await expect(page.locator('#taskIdsReadonly')).toContainText('EVAL-B-01-OFF');
      await expect(page.locator('#lifecycleHistory')).toContainText('draft → active（审核通过）');

      // 检查 Rubric 维度渲染
      const rubricNames = page.locator('#rubricDims .rubric-dim-name');
      await expect(rubricNames).toHaveCount(1);
      await expect(rubricNames.first()).toHaveValue('正确性');
    });

    test('题目表单编辑、Rubric 增删维度与保存并升版本', async ({ page }) => {
      await page.route('**/api/env/manifest', (route) => route.fulfill({ json: {} }));
      await page.route('**/api/test-sets', (route) =>
        route.fulfill({
          json: { testSets: [{ id: 'set-a', label: '测试集 A', taskIds: ['PAIRED-TASK-01'] }] },
        }),
      );
      await page.route('**/api/bank/tasks', (route) =>
        route.fulfill({
          json: {
            tasks: [
              {
                taskId: 'PAIRED-TASK-01',
                passToken: 'TOKEN_ALPHA',
                complete: true,
                testSetIds: ['set-a'],
              },
            ],
            nextTaskId: 'PAIRED-TASK-02',
          },
        }),
      );
      await page.route('**/api/bank/tasks/PAIRED-TASK-01', (route) =>
        route.fulfill({
          json: {
            taskId: 'PAIRED-TASK-01',
            prompt: '原题干 TOKEN_ALPHA',
            passToken: 'TOKEN_ALPHA',
            complete: true,
            lifecycle: 'active',
            rubric: {
              dimensions: [{ name: '维度1', scale: '1-5', weight: 1.0 }],
            },
          },
        }),
      );

      let savedPayload: Record<string, unknown> | null = null;
      await page.route('**/api/bank/tasks/PAIRED-TASK-01', (route) => {
        if (route.request().method() === 'PUT') {
          savedPayload = route.request().postDataJSON() as Record<string, unknown>;
          return route.fulfill({ json: { ok: true, taskId: 'PAIRED-TASK-01' } });
        }
        return route.fulfill({ json: { taskId: 'PAIRED-TASK-01', complete: true } });
      });

      await page.goto('/#bank');
      await page.locator('#taskList button').first().click();
      await expect(page.locator('#taskTitle')).toHaveText('PAIRED-TASK-01');

      // 编辑变更说明与题干
      await page.locator('#changeName').fill('优化终态词要求');
      await page.locator('#taskPrompt').fill('更新后题干 TOKEN_ALPHA');

      // Rubric 操作：添加新维度
      await page.locator('#addRubricDim').click();
      const dimRows = page.locator('#rubricDims .rubric-dim');
      await expect(dimRows).toHaveCount(2);

      // 为新增维度填入数据
      await dimRows.nth(1).locator('.rubric-dim-name').fill('代码规范');
      await dimRows.nth(1).locator('.rubric-dim-scale').fill('1-3');
      await dimRows.nth(1).locator('.rubric-dim-weight').fill('0.5');

      // 点击保存
      await page.locator('#saveTask').click();
      await expect(page.locator('#bankStatus')).toContainText('已保存并升版本');

      expect(savedPayload).not.toBeNull();
      expect(savedPayload!['changeName']).toBe('优化终态词要求');
      expect(savedPayload!['prompt']).toBe('更新后题干 TOKEN_ALPHA');
      expect(savedPayload!['rubric']).toEqual({
        dimensions: [
          { name: '维度1', scale: '1-5', weight: 1 },
          { name: '代码规范', scale: '1-3', weight: 0.5 },
        ],
      });

      // 删除第一个维度
      await dimRows.first().locator('button.danger').click();
      await expect(page.locator('#rubricDims .rubric-dim')).toHaveCount(1);
      await expect(page.locator('#rubricDims .rubric-dim-name').first()).toHaveValue('代码规范');
    });

    test('录题向导四步表单校验与成功提交', async ({ page }) => {
      await page.route('**/api/env/manifest', (route) => route.fulfill({ json: {} }));
      await page.route('**/api/test-sets', (route) =>
        route.fulfill({
          json: { testSets: [{ id: 'set-main', label: '主流程集', taskIds: [] }] },
        }),
      );
      await page.route('**/api/bank/tasks', (route) => {
        if (route.request().method() === 'POST') {
          return route.fulfill({
            json: { taskId: 'PAIRED-TASK-99', complete: true },
          });
        }
        return route.fulfill({
          json: {
            tasks: [{ taskId: 'PAIRED-TASK-01', passToken: 'OCCUPIED_TOKEN' }],
            nextTaskId: 'PAIRED-TASK-99',
          },
        });
      });
      await page.route('**/api/bank/tasks/PAIRED-TASK-99', (route) =>
        route.fulfill({
          json: { taskId: 'PAIRED-TASK-99', complete: true, prompt: '题干 TOKEN_FRESH' },
        }),
      );

      await page.goto('/#bank');
      await page.locator('#openCreateWizard').click();
      await expect(page.locator('#createWizard')).toBeVisible();

      // 第 1 步：题号与测试集校验
      await expect(page.locator('#wizardStepLabel')).toContainText('第 1 / 4 步 · 题号');
      // 测试边界：非法题号
      await page.locator('#wizTaskId').fill('INVALID_ID');
      await page.locator('#wizNext').click();
      await expect(page.locator('#wizardError')).toBeVisible();
      await expect(page.locator('#wizardError')).toContainText('题号须为 PAIRED-TASK-NN');

      // 输入合法题号与选择测试集
      await page.locator('#wizTaskId').fill('PAIRED-TASK-99');
      await page.locator('#wizTestSet').selectOption('set-main');
      await page.locator('#wizNext').click();

      // 第 2 步：题干非空与 Text-only 禁止词校验
      await expect(page.locator('#wizardStepLabel')).toContainText('第 2 / 4 步 · 题干');
      await page.locator('#wizPrompt').fill('这是纯文本题目 text-only 不要使用工具');
      await page.locator('#wizNext').click();
      await expect(page.locator('#wizardError')).toBeVisible();
      await expect(page.locator('#wizardError')).toContainText('题干禁止 Text-only');

      // 输入合法题干
      await page.locator('#wizPrompt').fill('请编写脚本并输出 TOKEN_FRESH 结束。');
      await page.locator('#wizNext').click();

      // 第 3 步：终态词校验
      await expect(page.locator('#wizardStepLabel')).toContainText('第 3 / 4 步 · 怎样算对');
      // 边界 A：被占用的终态词
      await page.locator('#wizToken').fill('OCCUPIED_TOKEN');
      await page.locator('#wizNext').click();
      await expect(page.locator('#wizardError')).toContainText('已被 PAIRED-TASK-01 占用');

      // 边界 B：终态词未包含在题干中
      await page.locator('#wizToken').fill('TOKEN_NOT_IN_PROMPT');
      await page.locator('#wizNext').click();
      await expect(page.locator('#wizardError')).toContainText('请把终态词写进题干');

      // 正常合法终态词与分层配置
      await page.locator('#wizToken').fill('TOKEN_FRESH');
      await page.locator('#wizStrataType').fill('coding');
      await page.locator('#wizStrataDifficulty').selectOption('L1');
      await page.locator('#wizNext').click();

      // 第 4 步：确认与预览
      await expect(page.locator('#wizardStepLabel')).toContainText('第 4 / 4 步 · 确认');
      await expect(page.locator('#wizPreview')).toContainText('PAIRED-TASK-99');
      await expect(page.locator('#wizPreview')).toContainText('TOKEN_FRESH');
      await expect(page.locator('#wizSubmit')).toBeVisible();

      // 提交
      await page.locator('#wizSubmit').click();
      await expect(page.locator('#createWizard')).toBeHidden();
      await expect(page.locator('#bankStatus')).toContainText('已录入 PAIRED-TASK-99');
    });

    test('题目删除确认交互与题库重新检查', async ({ page }) => {
      await page.route('**/api/env/manifest', (route) => route.fulfill({ json: {} }));
      await page.route('**/api/test-sets', (route) =>
        route.fulfill({
          json: { testSets: [{ id: 'set-a', label: '测试集 A', taskIds: ['PAIRED-TASK-01'] }] },
        }),
      );
      let taskList = [{ taskId: 'PAIRED-TASK-01', complete: true, testSetIds: ['set-a'] }];
      await page.route('**/api/bank/tasks', (route) => {
        return route.fulfill({ json: { tasks: taskList, nextTaskId: 'PAIRED-TASK-02' } });
      });
      await page.route('**/api/bank/tasks/PAIRED-TASK-01', (route) => {
        if (route.request().method() === 'DELETE') {
          taskList = [];
          return route.fulfill({ json: { ok: true } });
        }
        return route.fulfill({
          json: { taskId: 'PAIRED-TASK-01', complete: true },
        });
      });
      await page.route('**/api/bank/validate', (route) =>
        route.fulfill({ json: { ok: true, summary: '全量题库检查通过' } }),
      );

      await page.goto('/#bank');
      await page.locator('#taskList button').first().click();
      await expect(page.locator('#taskTitle')).toHaveText('PAIRED-TASK-01');

      // 打开删除弹窗
      await page.locator('#deleteTask').click();
      await expect(page.locator('#deleteDialog')).toBeVisible();
      await expect(page.locator('#deleteExpected')).toHaveText('PAIRED-TASK-01');

      // 输入错误的题号确认，断言被拦截
      await page.locator('#deleteConfirmId').fill('WRONG-TASK-ID');
      await page.locator('#deleteConfirmBtn').click();
      await expect(page.locator('#deleteError')).toBeVisible();
      await expect(page.locator('#deleteError')).toContainText('请原样输入题号');

      // 输入正确的题号并确认删除
      await page.locator('#deleteConfirmId').fill('PAIRED-TASK-01');
      await page.locator('#deleteConfirmBtn').click();

      // 弹窗关闭，回退到空态，题库校验联动触发
      await expect(page.locator('#deleteDialog')).toBeHidden();
      await expect(page.locator('#bankStatus')).toContainText('已删除 PAIRED-TASK-01');
      await expect(page.locator('#editEmpty')).toBeVisible();
      await expect(page.locator('#bankSummary')).toContainText('全量题库检查通过');
    });

    test('一键检查题库按钮状态流转与失败汇总展示', async ({ page }) => {
      await page.route('**/api/env/manifest', (route) => route.fulfill({ json: {} }));
      await page.route('**/api/test-sets', (route) => route.fulfill({ json: { testSets: [] } }));
      await page.route('**/api/bank/tasks', (route) =>
        route.fulfill({ json: { tasks: [], nextTaskId: 'PAIRED-TASK-01' } }),
      );
      await page.route('**/api/bank/validate', (route) =>
        route.fulfill({
          status: 200,
          json: {
            ok: false,
            exitCode: 1,
            summary: '发现 2 处格式缺陷',
            log: 'PAIRED-TASK-05: 缺少终态词',
          },
        }),
      );

      await page.goto('/#bank');
      await page.locator('#validateBank').click();

      await expect(page.locator('#bankSummary')).toContainText('发现 2 处格式缺陷');
      await expect(page.locator('#bankSummary')).toHaveClass(/err/);
      await expect(page.locator('#bankLog')).toContainText('PAIRED-TASK-05: 缺少终态词');
      await expect(page.locator('#bankStatus')).toContainText('检查失败 exit=1');
    });
  });

  test.describe('数据集管理交互 (Datasets)', () => {
    test('数据集列表浏览、选中加载详情、分层覆盖矩阵与未覆盖警告', async ({ page }) => {
      await page.route('**/api/env/manifest', (route) => route.fulfill({ json: {} }));
      await page.route('**/api/test-sets', (route) =>
        route.fulfill({
          json: {
            testSets: [
              { id: 'ts-core', label: '核心对照集', taskIds: ['PAIRED-TASK-01', 'PAIRED-TASK-02'] },
              { id: 'ts-extended', label: '扩展补充集', taskIds: ['PAIRED-TASK-03'] },
            ],
          },
        }),
      );
      await page.route('**/api/test-sets/ts-core', (route) =>
        route.fulfill({
          json: {
            id: 'ts-core',
            label: '核心对照集',
            offRelease: 'v1.0.0',
            onRelease: 'v1.1.0',
            description: '评测万象术核心插件能力',
            coverage: {
              offCount: 2,
              onCount: 2,
              matrix: {
                coding: { L1: 1, L2: 1 },
                reasoning: { L2: 0, L3: 1 },
              },
              missing: ['PAIRED-TASK-02'],
              unreadable: [],
            },
            tasks: [
              {
                taskId: 'PAIRED-TASK-01',
                strata: { task_type: 'coding', difficulty_level: 'L1' },
                lifecycle: 'active',
                tags: ['基础'],
              },
              {
                taskId: 'PAIRED-TASK-02',
                strata: null,
                lifecycle: 'candidate',
                tags: [],
              },
            ],
          },
        }),
      );
      await page.route('**/api/test-sets/ts-extended', (route) =>
        route.fulfill({
          json: {
            id: 'ts-extended',
            label: '扩展补充集',
            offRelease: 'v0.9.0',
            onRelease: 'v0.9.0',
            description: '仅补充题',
            coverage: {
              offCount: 1,
              onCount: 1,
              matrix: {
                review: { L1: 1 },
              },
              missing: [],
              unreadable: [],
            },
            tasks: [
              {
                taskId: 'PAIRED-TASK-03',
                strata: { task_type: 'review', difficulty_level: 'L1' },
                lifecycle: 'draft',
              },
            ],
          },
        }),
      );

      await page.goto('/#datasets');
      await expect(page.locator('#pageDatasets')).toBeVisible();

      // 数据集初始化默认自动加载第 0 个 (ts-core)
      await expect(page.locator('#datasetTitle')).toHaveText('核心对照集');
      await expect(page.locator('#datasetMeta')).toContainText(
        '短名 ts-core · 无插件 v1.0.0 · 有插件 v1.1.0',
      );
      await expect(page.locator('#datasetCounts')).toContainText(
        '无插件侧（OFF）2 题 · 有插件侧（ON）2 题 · 共 2 题',
      );

      // 验证矩阵渲染 (table)
      const matrixTable = page.locator('#datasetMatrix table.dataset-matrix-table');
      await expect(matrixTable).toBeVisible();
      await expect(matrixTable).toContainText('任务类型 \ 难度');
      await expect(matrixTable).toContainText('coding');
      await expect(matrixTable).toContainText('reasoning');

      // 验证未覆盖警告提示
      await expect(page.locator('#datasetMissing')).toBeVisible();
      await expect(page.locator('#datasetMissing')).toContainText(
        '未覆盖 · 缺分层：PAIRED-TASK-02',
      );

      // 验证题目列表
      const taskItems = page.locator('#datasetTasks li');
      await expect(taskItems).toHaveCount(2);
      await expect(taskItems.nth(0)).toContainText('PAIRED-TASK-01');
      await expect(taskItems.nth(0)).toContainText('类型 coding · 难度 L1 · active · 基础');
      await expect(taskItems.nth(1)).toContainText('PAIRED-TASK-02');
      await expect(taskItems.nth(1)).toContainText('（未分层）');

      // 切换到第二个数据集
      const datasetBtns = page.locator('#datasetList button');
      await expect(datasetBtns).toHaveCount(2);
      await datasetBtns.nth(1).click();

      // 验证详情更新
      await expect(page.locator('#datasetTitle')).toHaveText('扩展补充集');
      await expect(page.locator('#datasetMissing')).toBeHidden();
      await expect(page.locator('#datasetTasks li')).toHaveCount(1);
      await expect(page.locator('#datasetTasks li').first()).toContainText('PAIRED-TASK-03');
    });

    test('新建测试集对话框弹出与取消关闭', async ({ page }) => {
      await page.route('**/api/env/manifest', (route) => route.fulfill({ json: {} }));
      await page.route('**/api/test-sets', (route) =>
        route.fulfill({
          json: { testSets: [] },
        }),
      );

      await page.goto('/#datasets');
      await page.locator('#newTestSetTop').click();

      const dialog = page.locator('#newTestSetDialog');
      await expect(dialog).toBeVisible();
      await page.locator('#newTestSetName').fill('临时对照集');
      await page.locator('#newTestSetDesc').fill('临时验证用');

      await page.locator('#newTestSetCancel').click();
      await expect(dialog).toBeHidden();
    });
  });

  test.describe('运行环境与复现清单交互 (Env)', () => {
    test('运行环境 Catalog 加载、未验证告警样式与一键 Hello World 验证', async ({ page }) => {
      let catalog = {
        models: [
          { id: 'model-verified', verifiedAt: '2026-10-22T08:00:00Z' },
          { id: 'model-unverified', verifiedAt: null },
        ],
        agents: [{ id: 'agent-verified', verifiedAt: '2026-10-22T08:00:00Z' }],
      };

      await page.route('**/api/env/catalog', (route) => route.fulfill({ json: catalog }));
      await page.route('**/api/env/environments', (route) =>
        route.fulfill({ json: { environments: [] } }),
      );
      await page.route('**/api/env/manifest', (route) =>
        route.fulfill({
          json: {
            gitCommit: 'abc1234',
            worktreeDirty: false,
            nodeVersion: 'v20.18.0',
            osPlatform: 'darwin',
            osArch: 'arm64',
            lockfileSummary: 'sha256-valid',
          },
        }),
      );

      await page.route('**/api/env/verify', (route) => {
        catalog = {
          ...catalog,
          models: [
            { id: 'model-verified', verifiedAt: '2026-10-22T08:00:00Z' },
            { id: 'model-unverified', verifiedAt: '2026-10-23T12:00:00Z' },
          ],
        };
        return route.fulfill({
          json: {
            ok: true,
            catalog,
            log: 'Hello World 验证通过，返回正常。',
          },
        });
      });

      await page.goto('/#env');
      await expect(page.locator('#pageEnv')).toBeVisible();

      // 验证模型按钮列表
      const modelBtns = page.locator('#modelList button');
      await expect(modelBtns).toHaveCount(2);
      await expect(modelBtns.nth(0)).toContainText('model-verified');
      await expect(modelBtns.nth(0)).toContainText('已验证');
      await expect(modelBtns.nth(1)).toContainText('model-unverified');
      await expect(modelBtns.nth(1)).toContainText('未验证');
      await expect(modelBtns.nth(1)).toHaveClass(/warn/);

      // 点击未验证模型，触发 Hello World 验证
      await modelBtns.nth(1).click();

      // 验证通过，日志展开，状态变为已验证
      await expect(page.locator('#envLog')).toBeVisible();
      await expect(page.locator('#envLog')).toContainText('Hello World 验证通过');
      await expect(page.locator('#envStatus')).toContainText('model-unverified 验证通过');
      await expect(modelBtns.nth(1)).toContainText('已验证');
      await expect(modelBtns.nth(1)).not.toHaveClass(/warn/);
    });

    test('添加模型与添加 Agent 交互', async ({ page }) => {
      let catalog = { models: [], agents: [] };
      await page.route('**/api/env/catalog', (route) => route.fulfill({ json: catalog }));
      await page.route('**/api/env/environments', (route) =>
        route.fulfill({ json: { environments: [] } }),
      );
      await page.route('**/api/env/manifest', (route) => route.fulfill({ json: {} }));

      await page.route('**/api/env/models', (route) => {
        const body = route.request().postDataJSON() as { id: string };
        catalog = {
          ...catalog,
          models: [{ id: body.id, verifiedAt: null }],
        };
        return route.fulfill({ json: catalog });
      });

      await page.goto('/#env');

      // 输入新模型并添加
      await page.locator('#newModelId').fill('gpt-4o-test');
      await page.locator('#addModel').click();

      await expect(page.locator('#newModelId')).toHaveValue('');
      await expect(page.locator('#envStatus')).toContainText('已添加模型 gpt-4o-test');
      await expect(page.locator('#modelList button')).toHaveCount(1);
      await expect(page.locator('#modelList button').first()).toContainText('gpt-4o-test');
    });

    test('环境卡片 (Environment Card) 渲染、字段配置与生命周期流转', async ({ page }) => {
      await page.route('**/api/env/catalog', (route) =>
        route.fulfill({
          json: {
            models: [{ id: 'model-a', verifiedAt: '2026-10-20' }],
            agents: [{ id: 'agent-a', verifiedAt: '2026-10-20' }],
          },
        }),
      );
      await page.route('**/api/env/manifest', (route) => route.fulfill({ json: {} }));

      let currentEnv = {
        name: 'standard-eval-env',
        lifecycle: 'draft',
        workspace: 'isolated',
        network: false,
        recipe: {
          host_model: 'model-a',
          host_agent: 'agent-a',
          host_plugin: 'plugins/core',
          managed_agents: ['sub-agent-1'],
        },
      };

      await page.route('**/api/env/environments', (route) =>
        route.fulfill({ json: { environments: [currentEnv] } }),
      );

      let savedEnvPayload: Record<string, unknown> | null = null;
      await page.route('**/api/env/environments/standard-eval-env', (route) => {
        savedEnvPayload = route.request().postDataJSON() as Record<string, unknown>;
        currentEnv = { ...currentEnv, ...savedEnvPayload };
        return route.fulfill({ json: currentEnv });
      });

      await page.goto('/#env');

      const card = page.locator('#environmentList .environment-card');
      await expect(card).toHaveCount(1);
      await expect(card.locator('h3')).toHaveText('standard-eval-env');

      // 验证生命周期徽章为 draft
      await expect(card.locator('.lifecycle-badge')).toHaveText('draft');

      // 验证表单初始值
      await expect(card.locator('label:has-text("模型") input')).toHaveValue('model-a');
      await expect(card.locator('label:has-text("Agent") input')).toHaveValue('agent-a');
      await expect(card.locator('label:has-text("插件") input')).toHaveValue('plugins/core');
      await expect(card.locator('label:has-text("托管 Agent") input')).toHaveValue('sub-agent-1');
      await expect(card.locator('label:has-text("工作区") select')).toHaveValue('isolated');
      await expect(card.locator('label.check input[type="checkbox"]')).not.toBeChecked();

      // 点击流转生命周期为 active (按钮文本为 "→ active")
      const toActiveBtn = card.locator('.lifecycle-actions button', { hasText: '→ active' });
      await expect(toActiveBtn).toBeVisible();
      await toActiveBtn.click();

      // 等待 debounce 保存并断言状态
      await expect(page.locator('#envStatus')).toContainText('standard-eval-env 已保存', {
        timeout: 5000,
      });
      expect(savedEnvPayload).not.toBeNull();
      expect(savedEnvPayload!['lifecycle']).toBe('active');
    });

    test('复现清单 (Repro Manifest) 信息展示', async ({ page }) => {
      await page.route('**/api/env/catalog', (route) =>
        route.fulfill({ json: { models: [], agents: [] } }),
      );
      await page.route('**/api/env/environments', (route) =>
        route.fulfill({ json: { environments: [] } }),
      );
      await page.route('**/api/env/manifest', (route) =>
        route.fulfill({
          json: {
            gitCommit: '7f8c9d0',
            worktreeDirty: true,
            nodeVersion: 'v20.18.0',
            osPlatform: 'darwin',
            osArch: 'arm64',
            lockfileSummary: 'sha256-abcdef1234567890',
          },
        }),
      );

      await page.goto('/#env');

      const manifest = page.locator('#reproManifest');
      await expect(manifest).toBeVisible();
      await expect(manifest).toContainText('7f8c9d0');
      await expect(manifest).toContainText('脏（有未提交改动）');
      await expect(manifest).toContainText('v20.18.0');
      await expect(manifest).toContainText('darwin/arm64');
      await expect(manifest).toContainText('sha256-abcdef1234567890');
    });
  });
});
