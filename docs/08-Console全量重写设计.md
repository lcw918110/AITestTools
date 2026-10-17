# 08 · Console 全量重写设计（阶段 5）

> 状态：**设计稿，待评审**（未写代码）
> 归属：Phase 1 阶段 5，把 console 的「测试集=成对 paperset」概念整体替换为「dataset-release + case-revision 配对」
> 权威依据：`docs/06-V2.17深迁移方案.md` §3 阶段 5、`docs/02-总体架构与领域设计.md` §3
> 前置：阶段 4a（CLI 已切 cases-v1）、阶段 4b（ExecutionAdapter 状态机已落地）

---

## 1. 目标与非目标

### 1.1 目标

把 `apps/console/*` 从读 papers-v1 资产（`bank/items/B/*.item.json`、`papersets/`、`rooms/`）整体切换到 cases-v1 资产（`cases/`、`case-revisions/`、`dataset-releases/`、`environments/`），彻底去除 paperset 概念。

### 1.2 非目标（本次不做）

- 不迁移 `bank/materials/`（materials 沿用，路径不变）。
- 不清理 papers-v1 资产（`bank/items/`、`papersets/`、`rooms/` 的删除属于阶段 6）。
- 不改 CLI（阶段 4a 已完成）。
- 不做 Phase 2~8（状态机持久化、指标、功能目录等）。

---

## 2. 数据模型映射（papers-v1 → cases-v1）

### 2.1 核心映射

| papers-v1 概念 | cases-v1 概念 | 说明 |
| :--- | :--- | :--- |
| `*.item.json`（OFF/ON 两个） | `*.case.json` + `*.case-revision.json`（`.off`/`.on` 两个 revision） | 逻辑身份 + 不可变修订 |
| `papersets/*.json`（成对 off/on） | `dataset-releases/*.json`（成对 off/on） | 命名已保留 |
| `rooms/*.json` | `environments/*.json` | 命名已保留 |
| `item.id`（`EVAL-B-PAIRED-TASK-22-OFF`） | `case_id`（`paired-task-22`）+ revision 变体 | 前缀/后缀拆解 |
| `item.rev` | `revision_number` | 修订号 |
| `item.stimulus.hosted_pass_token` | `CaseRevision.stimulus.hosted_pass_token` | 终态词 |
| `item.freeze.model_id` | `CaseRevision.model_id` | 基准模型 |
| `item.expect.oracles` | `CaseRevision.expect.oracles` | 判定器 |
| `paperset.items` | `DatasetRelease.case_revisions` | 冻结引用 |
| `paperset.room` | `CandidateConfig.environment_profile` | 环境引用 |

### 2.2 OFF/ON 配对

- papers-v1：`EVAL-B-PAIRED-TASK-22-OFF` / `EVAL-B-PAIRED-TASK-22-ON` 两个 item，通过 `intent.effect_pair` 关联。
- cases-v1：`paired-task-22.r2.off` / `paired-task-22.r3.on` 两个 CaseRevision，通过 `Case.pair_key` 关联。

**关键差异**：OFF/ON 的 `revision_number` 是**独立递增**的（r2.off 和 r3.on 可能不同号）。console 的 `versionLabel`（`无插件 v2 · 有插件 v3`）逻辑需适配。

---

## 3. 分步实施计划

### 步骤 1：读路径切换（project-reader + test-sets + run-plan）

把「读」papers-v1 的路径切到 cases-v1：

| 文件 | 改动 |
| :--- | :--- |
| `project-reader.ts` | `papersets/` → `dataset-releases/`，`rooms/` → `environments/` |
| `test-sets.ts` | `papersets/` → `dataset-releases/`，`offPaperset/onPaperset` → `offRelease/onRelease` |
| `run-plan.ts` | `paperset` → `dataset-release`，`papersets: PapersetIndex[]` → `releases: ReleaseIndex[]` |

**口径**：UI 的「测试集」概念保留（用户仍看到「全量/效果小样本」等），但底层字段名从 `paperset` 改为 `release`。API 返回字段也同步改（`offPaperset` → `offRelease`）。

### 步骤 2：写路径切换（bank.ts 录题/改题/删除）

把「写」papers-v1 的路径切到 cases-v1：

| 函数 | 改动 |
| :--- | :--- |
| `loadPairedItems` | 读 `bank/items/B/*.item.json` → 读 `cases/` + `case-revisions/` |
| `createTask` | 写 `*.item.json` → 写 `*.case.json` + `*.case-revision.json`（OFF/ON 两个 revision） |
| `updateTask` | 改 `*.item.json` → 改 CaseRevision（升 revision_number + content_hash） |
| `deleteTask` | 删 `*.item.json` → 删 Case + CaseRevision |

**关键决策**：`content_hash` 的计算。cases-v1 的 CaseRevision 有 `content_hash`（规范化摘要），录题/改题时必须重算。需复用 `scripts/migrate-v2.mjs` 里的 hash 逻辑，或从 `src/exam-engine/loader.ts` 的 `revisionDigest` 提取。

### 步骤 3：env 路径切换（env-catalog + controllers/env）

| 文件 | 改动 |
| :--- | :--- |
| `env-catalog.ts` | `rooms/` → `environments/`，`host.model` → `recipe.host_model`，`host.agent` → `recipe.host_agent`，`host.managed_agents` → `recipe.managed_agents` |
| `controllers/env.ts` | 同上 |

### 步骤 4：UI 前端同步（public/*.js）

`public/app.js`、`public/bank.js`、`public/env.js` 里的字段名同步（`paperset` → `release` 等）。

---

## 4. 关键决策点（需评审确认）

| # | 决策 | 建议 | 说明 |
| :--- | :--- | :--- | :--- |
| 1 | UI「测试集」概念是否改名 | **保留「测试集」**，仅底层字段 `paperset`→`release` | 用户无感，降低 UI 改动风险 |
| 2 | API 返回字段 `offPaperset` 是否改名 | **改名 `offRelease`** | 彻底去除 paperset 概念 |
| 3 | `content_hash` 计算 | **复用 loader 的 revisionDigest** | 避免两套 hash 逻辑 |
| 4 | OFF/ON revision 号独立递增 | **保留独立递增** | 与 cases-v1 现状一致 |
| 5 | 录题默认模型 `DEFAULT_MODEL` | **保留** | 与现状一致 |

---

## 5. 测试策略（红绿）

1. **红测**：`test-sets.ts` 的 `listTestSets` 读 `dataset-releases/` 返回与 papers-v1 等价的结果。
2. **红测**：`bank.ts` 的 `listTasks` 读 `cases/`+`case-revisions/` 返回与 papers-v1 等价的 318 题。
3. **绿测**：console 各 API 端到端返回正确（`/api/test-sets`、`/api/bank/tasks`、`/api/env/catalog`）。
4. **回归**：录题/改题/删除流程（用临时 fixture，不污染真实资产）。

---

## 6. 评审要点（请重点看）

| # | 决策点 | 位置 |
| :--- | :--- | :--- |
| 1 | UI「测试集」概念保留、仅底层字段改名 | §4 决策 1 |
| 2 | API 字段 `offPaperset`→`offRelease` | §4 决策 2 |
| 3 | `content_hash` 复用 loader 的 revisionDigest | §4 决策 3 |
| 4 | 分步实施顺序（读路径 → 写路径 → env → UI） | §3 |
