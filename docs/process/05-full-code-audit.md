# 全量代码审核报告

| 字段     | 值                                                                                                          |
| :------- | :---------------------------------------------------------------------------------------------------------- |
| 日期     | 2026-09-24                                                                                                  |
| 项目     | AITestTools（`agent-proctor`）——TypeScript/Node.js 三轴 Agent 评测引擎 + 本地评测操作台                     |
| 审核范围 | 全量源码：`src/` 引擎 9 模块（80+ 文件）、`apps/console` 操作台（14 文件）、`tests/`（50 测试文件）         |
| 审核方法 | 八维度 review 结论 + `apps/console` 逐文件只读调查 + DevOps 真跑质量门禁验证（changelog §11）+ 测试覆盖核对 |
| 前置参考 | 产品原则审核、设计终审（`04-final-review.md`）——本项目是上述审核的补充，提供逐文件代码级评估                |

> **本报告为 2026-09-24 审计快照。** 报告所列缺陷（尤其控制台 H1–H6）在快照时点后的修复进展见 [01-changelog.md](01-changelog.md) §12。本文缺陷表中已修复条目标注「已修复（FIXED）」及修复方式。

---

## 1. 八维度审核结论

| 维度             | 结论       | 说明                                                                                                                                                                                                                               |
| :--------------- | :--------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Language**     | ✅ PERFECT | TypeScript 严格模式，无 `any` 滥用，类型定义充分（`src/exam-engine/types.ts`、`src/oracles/types.ts`）                                                                                                                             |
| **Simplicity**   | ✅ PERFECT | 无框架依赖。引擎纯 Node.js + 最小第三方库（ajv、promptfoo）。控制台纯 vanilla HTTP + SPA。零构建步骤。                                                                                                                             |
| **Granularity**  | ✅ PERFECT | 模块职责分明：runner 按轴（L1/L2/L3/B/C）独立文件，oracle 每种判定器独立文件（16个），CLI 每个命令独立文件                                                                                                                         |
| **Ergonomics**   | ✅ PERFECT | CLI 命名直观（`proctor run/compare/init`），API 通过 `src/index.ts` 单一入口公开，操作台零配置启动                                                                                                                                 |
| **Structure**    | ✅ FIXED   | `apps/console/server.ts` handler 650 行巨石 **已修复**（拆分为 26 行装配入口 + `router.ts` + `controllers/` 8 文件）；`contract/load.ts` 与 `exam-engine/loader.ts` 职责重叠仍存                                                   |
| **Tests**        | ⚠️ REVISE  | `src/` 引擎模块测试覆盖较全（50 文件 289 用例全绿）；**HTTP 层测试已补**（`tests/console/` 下 12 个测试含 `server-http.test.ts` 与 `update-task-rollback.test.ts`），但 **前端零测试**仍存                                         |
| **Logic**        | ✅ FIXED   | 控制台 JSON 直写无原子性 **已修复**（`json-io.ts` 实现 `writeTextAtomic` Temp+Rename + `writeJsonAtomicCas` mtime CAS 乐观锁）；rooms PUT TOCTOU 竞态 **已解决**（CAS 防护）；`updateTask` 多文件写回滚 **已修复**（快照回滚机制） |
| **Completeness** | ⚠️ REVISE  | 引擎核心功能完整；操作台 HTTP 层测试与并发写入保护已补，但前端零测试与输入安全校验面仍存                                                                                                                                           |

---

## 2. 各模块评估

### 2.1 `src/exam-engine` —— 协议引擎（7 文件）

**优点**：协议全考卷化（papers-v1）实现在此。`schema.ts` 使用 ajv 对全部资产（item/case/paperset/room/suite/profile）进行 JSON Schema 校验，`validate.ts` 提供 item/case/project 三级验证，`loader.ts` 统一装载入口。`digest.ts` 的文件摘要与语义摘要在变更检测中发挥了关键作用。`index.ts`（34 行）作为模块公有 API 单一入口，导出干净。

**缺陷**：`loader.ts` 与 `project.ts` 的文件系统访问耦合较深——`collectFiles`、`loadItems`、`loadRooms` 直接调用 `readdirSync`/`readFileSync`，不支持自定义文件系统后端（如虚拟 FS 或远程协议），使 engine 测试高度依赖物理磁盘布局。

### 2.2 `src/run` —— 运行执行（18 文件）

**优点**：三轴 runner 分层优秀。`l1-runner.ts`（Fold 回放）、`l2-runner.ts`（剧本模型）、`l3-runner.ts`（Live 模型）、`b-runner.ts`（hosted B 轴）、`c-runner.ts`（直调契约）——每个 Runner 可独立测试与替换。`hosted-runner.ts` 统一编排 hosted 通道的完整周期（播种→运行→探针→判定），`gates.ts` 控制通过/失败的门禁逻辑。`hosted-workspace-state.ts`、`hosted-pass-token.ts`、`hosted-prompt.ts`、`hosted-oracles.ts` 等辅助模块各司其职，最长文件不超过 250 行。

**缺陷**：`runner-shared.ts` 命名模糊，未在文件名中表示它服务于哪些 Runner（实际上含 B 轴通用函数）；`write-artifacts.ts` 与 `src/report/artifacts.ts` 名冲突但职能不同（run 侧写产物、report 侧读产物），应区分命名或合并。`opencode-plugin-export.ts` 与 OpenCode 插件的耦合细节渗入引擎核心——需确认这是否该放在 drivers/ 层。

### 2.3 `src/oracles` —— 判定器（16 文件）

**优点**：判定器类型最齐全的模块。`workspace-assert.ts`（工作区文件断言）是效果评测的核心，`stdout-assert.ts`（标准输出断言）覆盖 contains/not_contains，`tool-side-effect.ts`（工具副作用）、`event-subsequence.ts`（事件子序列）支持协议级验证，`state-predicate.ts` 提供可组合的谓词表达式。每种判定器均为独立文件，`index.ts` 统一注册表。`types.ts` 定义 `OracleFn` 签名与判定上下文。

**缺陷**：16 个判定器中 `event-name.ts`、`metric-threshold.ts` 等在实际 papers 中使用率低（当前全量 318 题中仅少量试题引用），但维护开销平摊到全部。判定器的 `index.ts` 注册表为手写映射，新增 oracle 需同步更新两处（类型文件 + 注册表）。

### 2.4 `src/drivers` —— 模型/宿主驱动（5 子模块）

**优点**：驱动按职责分为 5 个独立子模块：`fold`（fixture 重放驱动 L1）、`scripted`（剧本模型 L2）、`cassette`（请求/响应录播）、`fakehost`（伪宿主 Mock 用于 testing）、`model-adapter`（promptfoo 适配为 L3 提供 Live 模型调用）。每种子模块不超过 3 文件，边界清晰。

**缺陷**：`model-adapter` 仅实现 promptfoo，对 OpenCode 的适配实际走 `opencode-plugin-export.ts`（在 run/ 下），这意味模型适配逻辑分散在 drivers/ 和 run/ 两处。`fakehost` 的 Mock 实现仅服务于测试框架，但其 `index.ts` 导出类型可能被 `src/` 生产代码引用——需确认隔离性。

### 2.5 `src/attribution` —— 失败归因（4 文件）

**优点**：`hosted-tree.ts` 实现六选一归因树（PROTOCOL / CONTEXT / MODEL_SCHEMA / MODEL_TASK / TOOL / HARNESS），因果链逻辑清晰，严格遵守"CONTEXT 不进效果结论"纪律。`event-store.ts` 从 NDJSON 探针重建代理会话图（识别 orchestrator/manager/engineer/devops 是否存在），`ndjson-probes.ts` 实现探针本身。

**缺陷**：`ndjson-probes.ts` 对万象术 EventStore 格式有硬编码约定（如 `.wanxiangshu.ndjson` 路径、`journal.envelope.kind` 字段），任何万象术侧 EventStore 格式变更都可能破坏归因。缺少可配置的探针路径——当前仅通过文件系统中的已知位置探测。

### 2.6 `src/contract` —— 宿主契约（3 文件）

**优点**：`probe.ts` 和 `runtime-probe.ts` 分别提供静态契约校验与运行时探针 sidecar，支撑 C 轴（直调契约）评测。`load.ts` 处理契约资产的加载。

**缺陷**：`load.ts` 与 `exam-engine/loader.ts` 的部分功能重叠（都包含 `readFileSync` + JSON 解析 + schema 校验逻辑），边界不够清晰。contract 模块仅 3 文件，职责描述为"宿主契约"，但其类型与 exam-engine/types 有隐式耦合。

### 2.7 `src/report` —— 报告与对照（4 文件）

**优点**：`compare.ts` 是 OFF/ON 对照的核心，支持通过率计算、Δ 统计、CONTEXT 剔除及 `effect_compare.md` 生成。`cells.ts` 准备经济四格数据。`artifacts.ts` 提供产物标准化清单。`format.ts` 提供校验报告格式化。

**缺陷**：`format.ts` 为单函数硬编码格式（`formatValidationReport`），不支持扩展为多种输出格式（JSON/HTML 等）。`artifacts.ts` 与 `run/write-artifacts.ts` 命名冲突——前者读产物清单，后者写产物，建议分别命名为 `artifact-index.ts` 与 `write-artifacts.ts`（或合并）。

### 2.8 `src/cli` —— 命令行入口（main + 17 命令）

**优点**：命令覆盖完整——`run`（运行评测）、`compare`（对照）、`item-validate/item-new/item-migrate/item-resolve/item-retire/item-bump-rev`（题目生命周期）、`baseline-pin`（基线管理）、`report-show/report-trend`（报告）、`contract-verify`（契约验证）、`cassette-record`（录播）、`init`（项目初始化）、`score-write`（记分）。每个命令为独立文件，`main.ts` 统一路由。

**缺陷**：17 个命令均在三层目录 `cli/commands/` 下，部分使用率极低（如 `item-retire.ts`、`item-migrate.ts` 当前题库仅 318 题且无退役/迁移需求）。命令间共享逻辑抽取得不够——如多个 `item-*` 命令各自调用 `loadItems`，但错误处理与输出格式不一致。

### 2.9 `src/metrics` —— 指标定义（仅 `catalog.ts`）

**优点**：`METRIC_CATALOG` 集中定义 18 项指标（横跨 A/B/C 三轴），每项含 `meaning`、`aggregation`、`higher_is_better`、`gateable` 四属性。`isGateable()` 函数显式处理 hosted 指标的特殊规则（`b_hosted_*` 不可挂门禁）。`findMetric()` 提供名称到规格的 O(1) 查找。

**缺陷（已覆盖）**：~~原无独立测试~~。**已由 `tests/metrics/catalog.test.ts`（28 用例）覆盖**，完整验证 `findMetric`（命中/未命中/大小写敏感/同一引用）、`isGateable`（全分支）、`METRIC_CATALOG`（18 项指标名唯一性等不变量）。

### 2.10 `apps/console` —— 本地评测操作台

**后端（9 个 .ts 文件，约 4088 行）**

优点：

- `bank.ts`（968 行）业务校验严密：`CREATE_TASK_ID_RE` 强制题号格式、`assertPromptContainsToken` 保证题干含终态词、`FORBIDDEN_TASK_TAGS` 拦截废弃标签、Text-only 题干硬门禁、终态词全局唯一性检查。`createTask` 实现校验失败全程回滚（`rollbackCreate`），`assertChangeName` 要求变更说明 ≥4 个字。`parseTags` 处理逗号分隔与数组两种格式，兼容性好。
- `test-sets.ts`、`env-catalog.ts`、`eval-tasks.ts` 各自封装对应的 CRUD 操作，职责明确。`run-plan.ts` 解耦实验类型（测模型/测万象术/测 Agent）到运行计划映射。

缺陷（**高严重度**）：

- **`server.ts` handler 650 行巨石 [已修复]**：原 `handler` 从 569–1219 行在一个函数中混写路由分发/JSON 解析/请求体读取/作业队列调度/静态文件服务/rooms PUT 读-改-写。**已拆分为 26 行装配入口 + `router.ts` + `controllers/` 8 文件**。
- **HTTP 层零测试 [已修复]**：原 `tests/console/` 仅有 9 个测试文件且无 HTTP 层覆盖。**已补齐至 12 个测试**——新增 `server-http.test.ts`（HTTP 路由、请求解析、错误码、静态文件 MIME）与 `update-task-rollback.test.ts`（updateTask 回滚）。
- **JSON 直写无原子性 [已修复]**：原所有写操作为 `writeFileSync` 直接覆盖。**已实现 `json-io.ts`**：`writeTextAtomic`（同目录临时文件 → `renameSync` 原子覆盖）、`writeJsonAtomic`（序列化 → 原子写）、`writeJsonAtomicCas`（mtime CAS 乐观锁拒绝并发覆盖）。
- **多文件写入无事务 [已修复]**：原 `updateTask` 分步写 `prompt.txt` → OFF item → ON item → paperset → bump 升版，中间失败不回滚。**已补入写前快照机制**：受影响文件路径与原内容先快照，任一步失败即恢复（`update-task-rollback.test.ts` 覆盖）。
- **rooms PUT TOCTOU 竞态 [已修复]**：原 `readFileSync` → `writeFileSync` 无锁。**已通过 `writeJsonAtomicCas` mtime CAS 乐观锁解决**：写前比对文件真实 mtime，不一致则拒绝覆盖，返回 false 由调用方感知并发冲突。
- **`void executeJob` 丢异常 [已修复]**：原 `void executeJob(job, opts)` 是 fire-and-forget 调用，Promise rejection 不会被捕获也不会影响 HTTP 响应。**已修复**：`controllers/run.ts` 对 `executeJob` 显式 `.catch()` 将异常写入 job 状态并落盘（`controllers/run.ts:107–118`），`server.ts` 装配入口对 `handleRequest` 用 `.catch()` 将 Promise rejection 以 500 响应回传（`server.ts:17`）。

**前端（5 个文件，约 2854 行）**

优点：纯 vanilla JavaScript + HTML5 + CSS3，零框架依赖，零构建步骤。`bank.js`/`env.js`/`app.js` 职责分明（题库编辑/环境配置/全局路由）。`index.html` 单页应用组织良好，顶栏"测试 | 题库 | 运行环境"三页标签切换。

缺陷（**高严重度**）：

- **前端零测试**：不存在任何对 `public/*.js` 或 `index.html` 的自动化测试（单元测试、集成测试或 E2E）。所有 UI 交互（表单验证、API 调用、DOM 更新、模态框、文件上传）仅靠人工点击验证。
- `app.js` 和 `bank.js` 中 API 调用直接使用 `fetch`，无统一请求拦截器——超时、重试、认证 token、错误 toast 在各处重复内联实现。
- `styles.css` 无 CSS 变量/设计 token 体系，颜色值、间距、字号硬编码散布各处。

---

## 3. 质量门禁状态

以下门禁为 DevOps 真跑验证（changelog §11, 2026-09-23），非文字声明：

| 门禁                                | 状态    | 实际结果                                | 证据来源      |
| :---------------------------------- | :------ | :-------------------------------------- | :------------ |
| `npm run typecheck`（tsc --noEmit） | ✅ 通过 | 0 错误                                  | changelog §11 |
| `npm test`（vitest run）            | ✅ 通过 | 50 文件 289 测试全绿                    | changelog §11 |
| `npm run format:check`（prettier）  | ✅ 通过 | 所有文件符合规范（修复 207 文件后）     | changelog §11 |
| `npm run validate:product-eval`     | ✅ 通过 | 318/318 试题协议校验通过，0 错误 0 警告 | changelog §11 |

**验证过程中发现的普通缺陷**（已在 DevOps 验证阶段修复）：

- `examples/product-eval/rooms/hosted-plugin-v1.json` 第 2 行 `_comment` 字段违反 `room.schema.json` 的 `additionalProperties: false`，级联引发 4 份试卷集判定考场缺失 → 已移除
- 全仓 207 个文件 prettier 代码风格未对齐 → 已格式化

**changelog §8 还记录了配置层缺陷**：

- `hosted-plugin-v1.json` 第 20 行 `host.agent` 误设为 `"engineer"`（应为 `"orchestrator"`），导致 ON 侧 Orchestrator → Manager → Engineer + DevOps 编排链完全未启动 → 已修复

---

## 4. 已发现缺陷汇总

### 高严重度

| #   | 缺陷                               | 位置                                                                                         | 描述                                                                                                                                                                                                      |
| :-- | :--------------------------------- | :------------------------------------------------------------------------------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| H1  | handler 650 行巨型函数 [已修复]    | ~~`apps/console/server.ts:569–1219`~~ 拆分为 26 行入口 + router + controllers                | 路由/解析/响应/作业调度/静态文件混在一个函数中，不可单元测试。**已拆分为 26 行装配入口 + `router.ts` + `controllers/` 8 文件**                                                                            |
| H2  | HTTP 层零测试 [已修复]             | ~~`tests/console/`（缺少 `server.test.ts`）~~ 已补齐至 12 测试                               | 原无 HTTP 层测试。**已补齐 `server-http.test.ts`（HTTP 路由/错误码/静态文件）+ `update-task-rollback.test.ts`**                                                                                           |
| H3  | 前端零测试                         | `apps/console/public/*`                                                                      | 无 JS/HTML/CSS 单元测试、集成测试或 E2E 测试，所有 UI 仅靠人工验证                                                                                                                                        |
| H4  | updateTask 多文件写无事务 [已修复] | ~~`apps/console/bank.ts:507–597`~~ 已补入快照回滚                                            | prompt.txt → OFF item → ON item → paperset → bump 分步写，中间失败不回滚。**已实现写前快照 + 失败恢复机制（`update-task-rollback.test.ts` 覆盖）**                                                        |
| H5  | rooms PUT TOCTOU 竞态 [已修复]     | ~~`apps/console/server.ts:719–735`~~ 已通过 CAS 解决                                         | readFileSync→修改→writeFileSync 非原子。**已通过 `writeJsonAtomicCas` mtime CAS 乐观锁拒绝并发覆盖**                                                                                                      |
| H6  | void executeJob 丢异常 [已修复]    | ~~`apps/console/server.ts:1095`~~ → `controllers/run.ts:107–118` + `server.ts:17` `.catch()` | fire-and-forget Promise rejection 无法传播到 HTTP 响应。**已修复**：`controllers/run.ts` 对 `executeJob` 显式 `.catch()` 落盘 job 错误状态，`server.ts` 装配入口对 `handleRequest` 用 `.catch()` 回传 500 |

### 中严重度

| #   | 缺陷                                               | 位置                                                                      | 描述                                                                                                                                                                                   |
| :-- | :------------------------------------------------- | :------------------------------------------------------------------------ | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M1  | 全局 JSON 直写无原子性 [已修复]                    | ~~原各写点 `writeFileSync` 直写~~ → 收敛至 `json-io.ts`                   | 所有文件写入为 `writeFileSync` 直接覆盖。**已实现 `writeTextAtomic` Temp+Rename + `writeJsonAtomicCas` mtime CAS**                                                                     |
| M2  | metrics/catalog 无独立测试 [已覆盖]                | ~~`src/metrics/catalog.ts`~~ → `tests/metrics/catalog.test.ts`（28 用例） | `findMetric`/`isGateable`/`METRIC_CATALOG` 原在 `tests/` 中零引用。**已覆盖**：`tests/metrics/catalog.test.ts` 完整验证 findMetric 边界、isGateable 全分支、METRIC_CATALOG 18 项不变量 |
| M3  | contract/load.ts 与 exam-engine/loader.ts 职责重叠 | `src/contract/load.ts` / `src/exam-engine/loader.ts`                      | 两处都实现 readFileSync + JSON 解析 + 校验，边界模糊，存在重复代码风险                                                                                                                 |
| M4  | opencode-plugin-export 位置不当                    | `src/run/opencode-plugin-export.ts`                                       | OpenCode 插件导出逻辑放在 run/ 而非 drivers/model-adapter，模型适配逻辑分散两处                                                                                                        |
| M5  | ndjson-probes EventStore 路径硬编码                | `src/attribution/ndjson-probes.ts`                                        | 万象术 EventStore 格式字段名硬编码，任何万象术侧变更都可能破坏归因                                                                                                                     |
| M6  | writeJson 无错误包装                               | `apps/console/bank.ts:460–462`                                            | `JSON.stringify` 失败（循环引用等）直接抛原始 TypeError，无业务语义包装                                                                                                                |

### 低严重度

| #   | 缺陷                                       | 位置                                                     | 描述                                                      |
| :-- | :----------------------------------------- | :------------------------------------------------------- | :-------------------------------------------------------- |
| L1  | runner-shared.ts 命名模糊                  | `src/run/runner-shared.ts`                               | 文件名未表示具体服务哪些 Runner                           |
| L2  | write-artifacts 与 report/artifacts 名冲突 | `src/run/write-artifacts.ts` / `src/report/artifacts.ts` | 同名 artifacts 但前者写产物、后者读产物清单               |
| L3  | oracle 注册表手写                          | `src/oracles/index.ts`                                   | 新增判定器需同步更新类型文件 + 注册表两处，易遗漏         |
| L4  | 多个 CLI 命令使用率极低                    | `src/cli/commands/item-retire.ts`、`item-migrate.ts` 等  | 当前题库 318 题无退役/迁移需求，命令存在但无对应业务流程  |
| L5  | console API 无统一请求拦截器               | `apps/console/public/app.js`、`bank.js`                  | fetch 调用中 timeout/retry/error toast 在各处重复内联实现 |
| L6  | styles.css 无设计 token 体系               | `apps/console/public/styles.css`                         | 颜色/间距/字号硬编码散布，修改需全局搜索替换              |

---

## 5. 结论与改进建议

### 整体评价

`agent-proctor` 引擎核心（`src/`）是扎实的 TypeScript 工程：类型系统完整、模块粒度合理、判定器种类齐全、CLI 命令覆盖周到。289 个测试全绿、typecheck 零错误、format 合规——**引擎核心的质量基线是健康的**。

`apps/console` 操作台原为质量断崖——server.ts 的 650 行 handler、全局 JSON 直写无原子性、多文件写无事务、HTTP 层零测试、前端零测试五项问题曾为数据安全与可维护性的实质风险。**前四项已于 2026-10-09 闭环**：server.ts 拆分为 26 行装配入口 + router + controllers、`json-io.ts` 实现 Temp+Rename 原子写与 mtime CAS 乐观锁、`updateTask` 补入快照回滚、`tests/console/` 补齐至 12 个测试含 HTTP 层覆盖。**前端零测试仍为未决。**

### 优先改进路径

1. **拆分 `server.ts` handler**（H1）✅ 已闭环——拆分为 26 行装配入口 + `router.ts` + `controllers/` 8 文件。
2. **补充 HTTP 层测试**（H2）✅ 已闭环——`tests/console/` 补齐至 12 个测试，含 `server-http.test.ts`。
3. **`writeJson` 改为原子写入**（M1）✅ 已闭环——`json-io.ts` 实现 `writeTextAtomic` Temp+Rename + `writeJsonAtomicCas` mtime CAS。
4. **`updateTask` 补充事务回滚**（H4）✅ 已闭环——写前快照 + 失败恢复机制，`update-task-rollback.test.ts` 覆盖。
5. **rooms PUT 加锁或改 CAS 语义**（H5）✅ 已闭环——`writeJsonAtomicCas` mtime CAS 乐观锁，拒绝并发覆盖。
6. **补充 `metrics/catalog.ts` 测试**（M2）✅ 已闭环——`tests/metrics/catalog.test.ts`（28 用例）完整覆盖 `findMetric` 所有 boundary（存在/不存在/hosted 前缀、大小写敏感、同一引用）、`isGateable` 的 true/false 分支、`METRIC_CATALOG` 的 18 项指标名唯一性等不变量。

---

_本报告基于 2026-09-23 changelog §11 DevOps 真跑验证的 4 道质量门禁 + 本 session 的逐文件结构核对与测试覆盖检查。所有行号引用基于审核时仓库状态。_
