# 06 · 下一步计划

| 字段 | 值                                                                                                          |
| :--- | :---------------------------------------------------------------------------------------------------------- |
| 日期 | 2026-10-24                                                                                                  |
| 角色 | 对 changelog §3 打开任务 T4/T5/T6/T7 的下一步执行计划，不作为新的需求或设计规格                             |
| 依赖 | [过程日志 §3–§42](01-changelog.md) · [术语篇](../00-glossary.md) · [_审视/主文档.md](../../_审视/主文档.md) |

本文件是对五项原始任务中「基于需求指定下一步计划」的交付物。执行依赖关系与当前阻塞点已坐实，以下不再重述调查过程。

---

## 1. 当前状态概览

### 已完成

| 任务       | 内容                                                                        | 完成标志                                         |
| :--------- | :-------------------------------------------------------------------------- | :----------------------------------------------- |
| T1         | 测试任务：按组卷筛题 + 勾选 + 任务类型                                      | changelog §2「已落地」                           |
| T2         | 测万象术无插件 / 有插件 / 同时跑                                            | changelog §2「已落地」                           |
| T3         | 可保存多条测试任务（选题 + 配置 + 跑次历史）                                | changelog §2「已落地」                           |
| T4         | 测试任务用途字段（7 类标准枚举校验、运行时锁定、GAP-4 趋势分桶防混算）      | changelog §42 / ISSUE-0008「已落地闭环」         |
| T5         | 题库难度分层字段（`strata.difficulty_level`，录题向导 + 编辑表单 + schema） | changelog §31 / ADR-0011「已落地」               |
| T6 前段    | Grill 共识 + 题面收紧 + 全链路打通报错定位                                  | changelog §6–§10；编排链断点坐实                 |
| GAP-3      | 控制台核心页面端到端测试套件扩展（Playwright 覆盖题库/数据集/环境与模型池） | changelog §42 / `tests/browser/`                 |
| GAP-4      | 趋势多用途筛选与独立分桶（CLI `--purpose`/`--bucket` + API + 前端，禁混算） | changelog §42 / `tests/cli/report-trend.test.ts` |
| ISSUE-0008 | 用途字段与跨用途防混算独立复核（7 类用途闭环、历史未知结果诊断）            | `_审视/主文档.md`（已关闭 VERIFIED / CLOSED）    |
| ——         | 独立验证：全仓 typecheck / vitest 427+ / format / product-eval 318/318      | changelog §40–§42                                |

### 进行中 / 阻塞

| 任务 | 内容                         | 状态                                                                              |
| :--- | :--------------------------- | :-------------------------------------------------------------------------------- |
| T6   | 效果实验 157–159 OFF/ON 对照 | **阻塞**。编排链 orchestrator → manager → devops 未接通（万象术插件侧外部依赖）。 |
| T7   | 测试结果经济四格             | **阻塞**。依赖 T6 提供有效效果数据。                                              |

---

## 2. 各任务前置条件与依赖

### T4（用途字段）与 GAP-4（趋势多用途分桶）

- **状态：** **已落地并复核关闭**（2026-10-24，changelog §42 / ISSUE-0008 / GAP-4）。
- **落地位置与事实凭据：**
  1. `apps/console/eval-tasks.ts`：7 类用途必选校验（`eval_comparison` / `calibration` / `regression` / `scaling` / `diagnostic` / `benchmark` / `exploration`）、提交即冻结锁定并写入运行元数据；
  2. `src/cli/commands/report-trend.ts` & `apps/console/router.ts` & `controllers/runs.ts`：实现 GAP-4 趋势多用途筛选与独立分桶（`collectTrendBuckets`），在多用途未过滤冲突时返回 400 及可用用途列表，彻底隔绝跨用途混算；
  3. `apps/console/public/index.html` & `trends.js`：提供单用途聚焦下拉与多用途分桶折线图；
  4. 自动化保护：`tests/browser/task-purpose.spec.ts`（用途必选/锁定/趋势）、`tests/cli/report-trend.test.ts`、`tests/console/runs-trend.test.ts`。ISSUE-0008 已在 `_审视/主文档.md` 正式标记关闭（VERIFIED / CLOSED）。

### T5（难度字段）

- **状态：** **已落地**（2026-10-19，commit `968905c`，ADR-0011 / changelog §31）。
- **落地位置：** `apps/console/public/index.html`（`taskStrataDifficulty` / `wizStrataDifficulty`）、`apps/console/public/bank.js`、`apps/console/bank.ts`（`assertStrata`）、`schemas/case-revision.schema.json`（`strata.difficulty_level`）。

### GAP-3（端到端测试套件扩展）

- **状态：** **已落地**（2026-10-24，changelog §42 / ISSUE-0003）。
- **落地位置与事实凭据：**
  - 新增 `tests/browser/console-core-pages.spec.ts`（600+ 行，10 个自动化用例），为题库管理（`bank.js`）、数据集管理（`datasets.js`）、运行环境与模型池（`env.js` / `model-pool.js`）补齐 Playwright 端到端断言；
  - 连同已有 `task-purpose.spec.ts` 与 `user-journeys.spec.ts`，由标准 npm 脚本 `npm run console:e2e`（`playwright test tests/browser/`）自动发现并执行，彻底终结「前端零测试」缺陷。

### T6（效果实验）

- **依赖链：** 编排链 orchestrator → manager → devops 必须接通，才能产生有效对照数据。
- **阻断原因：** 万象术 plugin 侧未实现 orchestrator commission tool → manager 的路由链路。orchestrator 输出已出现 `commission a Lead` 委派意图（changelog §10:288），但 manager / devops 会话在 EventStore 中始终为零。
- **已排除：** 死循环（已修复）、host.agent 配置（已从 `engineer` 修正为 `orchestrator`）、准入拒绝、配置校验拒绝——这些闸门已全部解决（changelog §7–§10）。
- **剩余问题：** 编排链未闭合属 SUT 侧工程问题，不在 agent-proctor 评测引擎仓改动范围。

### T7（经济四格）

- **依赖链：** T7 → T6 → 万象术编排链。
- **阻断原因：** 经济四格（[术语篇](../00-glossary.md#经济四格)）需有效效果对照数据支撑。T6 尚未产生有效对照（OFF 全过、ON 全挂归因为编排未启动，非题面设计问题），因此画经济四格的条件不满足。changelog §3 T7 已注明「效果差出来之前不画空图」。
- **定义归属：** 隔离的呈现层功能，底层效果数据到齐后可从本仓独立实现。

---

## 3. 推荐执行顺序

```
T4/T5 (已落地) + GAP-3/GAP-4 (已落地) → 等万象术编排链接通 (外部阻塞) → T6 → T7
```

### 第一阶段：T4 + T5 与控制台测试基建（已全部落地闭环）

- **做什么：** T4 在测试任务页新增用途字段（7 类标准枚举下拉与校验），落盘任务 JSON 与运行元数据，GAP-4 趋势分桶隔离并彻底禁绝跨用途混算，ISSUE-0008 复核关闭；T5 在题库编辑表单新增难度字段录入与展示，落盘试题；GAP-3 补齐控制台核心页面端到端测试。
- **现状：** 第一阶段任务已全部独立高质量交付，全量测试保护就绪。
- **结论：** 本仓当前已无第一阶段未决任务，主线顺延推进至第二阶段。

### 第二阶段：万象术编排链接通（外部团队依赖）

- **需要什么：** 万象术 plugin 侧实现 orchestrator commission tool → manager 的完整路由链路，使 manager fork engineer + resume devops 形成验证反馈闭环（changelog §10 方向）。
- **验证条件：** 小样本 157–159 ON run 的 EventStore 出现非零 manager + devops 会话，且至少一道题能走通 engineer → devops 运行 → engineer 反馈的闭环。

### 第三阶段：T6 完成有效对照

- **条件：** 万象术编排链接通后，重跑 157–159 ON 小样本对照。
- **DoD（已定，见 changelog §6）：**
  1. OFF 必挂、ON 有机会过（剔除 CONTEXT 后）
  2. 小样本对照跑通（paired-off-effect-smoke → paired-on-effect-smoke → compare）
  3. 报告可读出 OFF 通过率 < ON
  4. 156 全量不当效果结论
- **当前风险：** 有效对照从未跑通过，OFF/ON 的方向与 DoD 目标相反（OFF 全过、ON 全挂）。编排链接通后需验证根因是否仅在编排缺失。

### 第四阶段：T7 经济四格

- **条件：** T6 产出有效效果数据（Δ 可读、归因可分类）。
- **做什么：** 在测试结果页实现弱开 vs 强关的经济四格呈现。

---

## 4. 人力介入边界

| 工作项                                | 归属                  | 说明                                                                             |
| :------------------------------------ | :-------------------- | :------------------------------------------------------------------------------- |
| T4 用途字段                           | **已闭环落地**        | 操作台前端 + API + 任务 JSON schema + GAP-4 趋势分桶，ISSUE-0008 复核关闭        |
| T5 难度字段                           | **已闭环落地**        | 题库编辑表单 + 试题 schema，纯产品功能                                           |
| GAP-3 核心页面 E2E 测试               | **已闭环落地**        | Playwright 覆盖题库/数据集/环境/模型池核心页面交互，终结前端零测试               |
| T7 经济四格                           | **本仓可独立推进** \* | 呈现层功能，底层效果数据到齐后可独立开发                                         |
| T6 编排链 orchestrator → manager 路由 | **万象术团队**        | orchestrator commission 机制在万象术 plugin 业务逻辑层未实现（changelog §8–§10） |
| T6 效果对照（编排链打通后）           | **本仓可独立推进**    | 改题、跑对照、归因，复用已有 proctor 引擎路径                                    |
| agent 中文输出                        | **万象术团队**        | `PairProgrammingThoughtTransform.fs` 改变注入指导语不影响被测 agent 自身推理语言 |

> \* T7 标注「可独立推进」指开发能力上可以独立完成。实际开工需等待 T6 效果数据到齐。

**关键结论：** T4、T5、GAP-3、GAP-4 已全部闭环。当前唯一关键阻塞点（T6）完全在万象术侧编排链路，agent-proctor 评测引擎仓无需、也不应当为绕过编排链而改动引擎逻辑。T7 是后续任务，阻塞原因已明确（等待有效效果数据），不需要提前动手。

---

## 5. 已知改进项（非阻塞 backlog）

以下为 changelog 与工程备忘中记录的已知结构 / 质量改善项。它们不影响当前功能，但应在合适的时机处理。不在此排列优先级，仅记录现状。

| 项                       | 位置                                            | 描述                                                                                             | 状态      |
| :----------------------- | :---------------------------------------------- | :----------------------------------------------------------------------------------------------- | :-------- |
| server.ts handler 重构   | `apps/console/server.ts`                        | ~~单 handler 约 650 行，混路由解析 / JSON 解析 / 业务逻辑 / 响应写入，缺乏分层~~                 | ✅ 已闭环 |
| HTTP 层零测试            | `apps/console/server.ts`                        | ~~无任何 HTTP 处理层自动化测试（路由、错误码、请求体解析）~~                                     | ✅ 已闭环 |
| 前端零测试               | `apps/console/public/`                          | ~~无前端组件 / 交互测试~~                                                                        | ✅ 已闭环 |
| JSON 直写无并发保护      | `apps/console/server.ts`                        | ~~任务 JSON 与试题文件通过 `fs.writeFileSync` 直写，无锁或原子替换，并发写可能丢数据~~           | ✅ 已闭环 |
| updateTask 多文件回滚    | `apps/console/bank.ts`                          | `updateTask` 多文件写中间失败不回滚                                                              | ✅ 已闭环 |
| 作业异常 fire-and-forget | `apps/console/server.ts` / `controllers/run.ts` | ~~`void executeJob` 的 Promise rejection 无 `.catch()` 捕获，调用方收到 202 后无法感知作业失败~~ | ✅ 已闭环 |

> **已闭环说明：** server.ts 拆分为 26 行装配入口 + `router.ts` + `controllers/` 8 文件；HTTP 层测试已补充（`tests/console/` 下 12 个测试含 `server-http.test.ts`）；JSON 原子写已实现（`json-io.ts` 的 `writeTextAtomic` Temp+Rename + `writeJsonAtomicCas` mtime CAS 乐观锁）；`updateTask` 快照回滚已实现（`update-task-rollback.test.ts` 覆盖）；H6 作业异常 fire-and-forget 已修复（`controllers/run.ts` 对 `executeJob` 显式 `.catch()` 落盘 job 错误状态，`server.ts` 装配入口对 `handleRequest` 用 `.catch()` 回传 500）；**前端测试（GAP-3 / ISSUE-0003）已闭环**：通过 Playwright 建立了完整端到端测试套件（`tests/browser/` 下 `console-core-pages.spec.ts`, `task-purpose.spec.ts`, `user-journeys.spec.ts`），覆盖题库、数据集、环境与模型池以及任务用途/趋势等核心页面交互与契约断言，标准脚本 `console:e2e` 自动发现与执行。

---

## 6. 文档维护约定

- 本文在 T4 / T5 / GAP-3 / GAP-4 落地或 T6 阻塞解除时更新。
- 各任务进入实现阶段后，设计细节与 Grill 共识写入对应设计文档（需求 02/03、设计 08/09），不在本文展开。
- 改进项 backlog 新增或消除时同步更新 §5。
