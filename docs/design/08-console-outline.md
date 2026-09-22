# 08 · 产品控制台设计提纲

| 字段 | 值                                                                                                                                                                                 |
| :--- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 状态 | **现行**                                                                                                                                                                           |
| 日期 | 2026-09-09                                                                                                                                                                         |
| 依据 | [需求 02](../requirements/02-console-prd.md)；术语 [../requirements/00-glossary.md](../requirements/00-glossary.md)；过程 [../process/01-changelog.md](../process/01-changelog.md) |

---

## 1. 架构

```text
浏览器 UI (static)
    │  HTTP JSON
本地 Console Server (Node)
    │  spawn / 读写约定目录
agent-proctor CLI + examples/product-eval
```

- 控制台与引擎同仓：`apps/console/`
- **不**改 papers-v1 协议；编排命令 + 读写白名单字段
- 默认 `--project examples/product-eval`
- 启动：`npm run console` → `http://127.0.0.1:8787`

---

## 2. 信息架构（顶栏三页）

三页定义见 [术语篇](../requirements/00-glossary.md)。顶栏 **测试 | 题库 | 运行环境**（hash：`#test` / `#bank` / `#env`）；测试页含测试任务 + 测试结果。一次开跑 = 测试集 × 运行环境。

| 块             | 内容                                                                                                                                 | 状态    |
| :------------- | :----------------------------------------------------------------------------------------------------------------------------------- | :------ |
| **测试任务**   | 左侧列表；当前任务：只读类型、测试集、本题要跑的题目、测万象术才有无插件、已验证模型/Agent、高级、运行测试                           | 本刀    |
| **测试结果**   | 当前任务的跑次历史（默认最近一次）；明细 + 分析                                                                                      | 本刀    |
| **题库**       | 独立页；按测试集筛；向导第 1 步选/新建测试集                                                                                         | 本刀    |
| **运行环境页** | 增改模型/Agent；Hello World 验证；清单在 `rooms/.console-catalog.json`                                                               | 本刀    |

零新路由框架。勾选不写回测试集。用途字段不做（T4）。难度不录入。任务页不新建模型/Agent。

---

## 3. 能力对照

| 能力             | 引擎侧                              | 控制台侧                                           |
| :--------------- | :---------------------------------- | :------------------------------------------------- |
| 三实验映射       | paperset/room 已齐                  | ✅ 测试任务类型（新建时选，之后只读）          |
| 运行测试（模型/Agent） | `proctor run`                   | ✅ HTTP + 日志                                     |
| 运行测试（测万象术）   | `eval:paired` 或按选题 `--only` | 默认仍 156；选题后不写回正式卷；**不当效果结论**   |
| 测试结果         | run 产物 + compare                  | ✅ `/api/runs/view` 含 `dashboard`；挂在任务 `runs` |
| 环境             | env / rooms                         | ✅ 运行环境页配置+验证；任务快照；高级：只校验 |
| 测试集           | papersets 成对文件                  | ✅ 界面按人题名单合并；录题挂所选套           |
| 题库列表/编辑    | 文件系统 + item CLI                 | ✅ **严格版已验收** · [09](09-bank-editor.md)；向导可选任务类型 |

---

## 4. 实验预设与本次配置

| id       | 标签     | 默认测试集 | 有无插件（仅测万象术） |
| :------- | :------- | :--------- | :--------------------- |
| `model`  | 测模型   | 全量       | 无（固定无插件侧）     |
| `plugin` | 测万象术 | 全量       | 默认同时跑             |
| `agent`  | 测 Agent | 全量       | 无（固定无插件侧）     |

测试集下拉：效果小样本 / 校准 / 全量 / 冒烟 / 校准（对照模型）/ 自建。磁盘 `paired-off`+`paired-on` → 全量；`paired-*-effect-smoke` → 效果小样本。`eval-model` / `eval-agent` / `eval-model-alt` 不进测试集。

未改测试集、有无插件、勾选：测万象术真跑仍 `eval:paired`（156，不当效果结论）。改过则 `proctor run --paperset … --only <引擎条目id>`。勾选不写回测试集；录题挂入所选测试集时写名单。

界面文案：主按钮「运行测试」。任务上运行环境：已验证的**模型**、**Agent**（真跑必选）+ 测万象术才有的有无插件；快照记在任务上。类型只在新建对话框选择。输入提示用中文。

---

## 5. API

### 5.1 阶段 A（已实现）

| 方法 | 路径                   | 说明                                                                                          |
| :--- | :--------------------- | :-------------------------------------------------------------------------------------------- |
| GET  | `/api/health`          | 探活                                                                                          |
| GET  | `/api/presets`         | 三实验；含 `defaultExamMode` / `defaultPaperset`（`examMode` 仅 plugin 有意义）                |
| GET  | `/api/project`         | 考卷摘要；`papersets[]`；`testSets[]`（id / label / taskIds / offPaperset / onPaperset） |
| GET  | `/api/test-sets`       | 列出测试集                                                                                |
| POST | `/api/test-sets`       | 新建空测试集 `{ name, description }` → 成对 paperset 文件                                 |
| GET  | `/api/env/catalog`     | 模型 / Agent 清单（含是否已验证）                                                         |
| POST | `/api/env/models`      | 新增模型 id                                                                               |
| POST | `/api/env/agents`      | 新增 Agent id（并写入 hosted 房间 `managed_agents`）                                      |
| POST | `/api/env/verify`      | `{ kind: model\|agent, id }` Hello World 探活；`PROCTOR_CONSOLE_VERIFY_STUB=1` 可打标     |
| GET  | `/api/eval-tasks`      | 列出已保存的测试任务                                                                          |
| POST | `/api/eval-tasks`      | 新建；body 见下                                                                               |
| PUT  | `/api/eval-tasks/:id`  | 更新选题/配置；勾选不写回测试集                                                               |
| DELETE | `/api/eval-tasks/:id` | 删除该条（不删题库、不删 runs 目录）                                                        |
| POST | `/api/run`             | body 见下 → `{ jobId }`                                                                       |
| GET  | `/api/jobs/:id`        | 状态、日志尾、结果路径                                                                        |
| GET  | `/api/runs`            | 最近 run 目录列表（引擎产物；界面优先用任务上的 `runs`）                                      |
| GET  | `/api/runs/view?path=` | 读 run 产物 + **summary** + **dashboard**（配置条/矩阵/剔除后 Δ）+ 可选 `effect_structured`   |
| GET  | `/api/baselines`       | 列出 `baselines/*`                                                                            |
| POST | `/api/baselines/pin`   | body: `{ runPath, name }` → 钉选 baseline                                                     |
| POST | `/api/compare`         | body: `{ baseline, candidate, writeMd? }` → 对照；可写 effect_compare.md                      |

#### 测试任务 JSON（`eval-tasks/<id>.json`）

```json
{
  "id": "et-k2x9",
  "name": "效果烟卷",
  "kind": "plugin",
  "paperset": "paired-off-effect-smoke",
  "testSetId": "effect-smoke",
  "taskIds": ["PAIRED-TASK-157", "PAIRED-TASK-158", "PAIRED-TASK-159"],
  "examMode": "both",
  "live": true,
  "sutRoot": "",
  "model": "",
  "agent": "",
  "createdAt": "2026-09-08T00:00:00.000Z",
  "updatedAt": "2026-09-08T00:00:00.000Z",
  "runs": [{ "path": "/abs/runs/…", "startedAt": "…", "jobId": "job-…" }]
}
```

`kind` 创建后不可改。`testSetId` 是给人看的测试集；`paperset` 仍是无插件侧磁盘名，供开跑映射。`model` / `agent` 是任务快照，须为已验证项（真跑）。`taskIds` 是本题要跑的题目。

`POST /api/run` 可选字段（词义见术语篇）：

| 字段         | 取值                  | 说明                                       |
| :----------- | :-------------------- | :----------------------------------------- |
| `evalTaskId` | 测试任务 `id`         | 有则跑完把本次跑次路径追加到该任务 `runs`  |
| `examMode`   | `off` / `on` / `both` | **仅 `kind=plugin` 合法**；缺省为同时跑    |
| `paperset`   | 无插件侧磁盘名        | 可与 `testSetId` 互推                         |
| `testSetId`  | 测试集 id             | 筛题目用                                      |
| `taskIds`    | 人题号数组            | 本题要跑的题目；缺省为该测试集全部人题        |
| `live`       | boolean               | `false` 只校验；界面默认倾向 `true`           |
| `model`      | 字符串                | 真跑须为已验证模型                            |
| `agent`      | 字符串                | 真跑须为已验证 Agent                          |

非法 `examMode`、在测模型/测 Agent 上传 `on`/`both`、空清单、未知测试集 → `400`。离线（`live:false`）仍只走原校验路径。勾选不写测试集文件。未改三项时测万象术真跑仍 `eval:paired`。

`proctor run --only <itemId>` 可重复，只跑试卷中的这些引擎条目。

`POST /api/bank/tasks` 必填 `testSetId`（或先 `POST /api/test-sets`）。挂入该集两侧名单，不自动进全量。

### 5.2 阶段 B（题库 · 严格规则见 [09](09-bank-editor.md)）

| 方法   | 路径                      | 说明                                                                |
| :----- | :------------------------ | :------------------------------------------------------------------ |
| GET    | `/api/bank/tasks`         | 题目列表（含 `versionLabel` / `completeLabel` / `tags` / `notes` / `promptPreview`） |
| GET    | `/api/bank/tasks/:taskId` | 详情：`passToken`、`tags`、`offId`/`onId`（兼容 `hosted_pass_token`） |
| PUT    | `/api/bank/tasks/:taskId` | 强制升版；必填 `changeName`≥4；终态词须⊂题干                        |
| POST   | `/api/bank/tasks`         | 录题；题号 `PAIRED-TASK-NN`；失败回滚；成功后自动校验               |
| DELETE | `/api/bank/tasks/:taskId` | 须 `confirmId` 与题号一致                                           |
| POST   | `/api/bank/validate`      | `item validate --check-fixtures`；响应含人话 `summary`              |

#### `GET /api/bank/tasks` 响应

```json
{
  "tasks": [
    {
      "taskId": "PAIRED-TASK-02",
      "passToken": "yes",
      "offId": "EVAL-B-PAIRED-TASK-02-OFF",
      "onId": "EVAL-B-PAIRED-TASK-02-ON",
      "offRev": 1,
      "onRev": 1,
      "complete": true,
      "notes": "简介",
      "promptPreview": "题干前若干字"
    }
  ]
}
```

`complete=false`：缺 materials、或缺 OFF/ON 任一侧。

#### `PUT /api/bank/tasks/:taskId` body

> **口径以需求 03 / 设计 09 为准**：改题**强制升版**；**无**可选 `bumpRev` 开关。

```json
{
  "prompt": "…",
  "passToken": "yes",
  "notes": "…",
  "tags": ["coding"],
  "changeName": "放宽终态词说明"
}
```

| 字段             | 规则                                      |
| :--------------- | :---------------------------------------- |
| `passToken`      | 终态词；兼容旧名 `hosted_pass_token`      |
| `tags`           | 可选；任务类型，禁止废弃标签              |
| `changeName`     | **必填**，trim 后 ≥ 4；写入 bump-rev name |
| （无 bump 开关） | 每次保存**永远**对 OFF+ON 升 `rev`        |

行为：

1. 校验 `taskId`、路径在 `bank/` 下；题干须含终态词
2. 写 `prompt.txt`（若给了 `prompt`）
3. 同步写 OFF+ON 的 `stimulus.hosted_pass_token` / `notes` / `tags`（若给了对应字段）
4. 对每个被改 item 调用 `proctor item bump-rev <id> --project … --name <changeName>`
5. 返回更新后的详情

#### `POST /api/bank/tasks` body

```json
{
  "taskId": "PAIRED-TASK-06",
  "prompt": "Reply with exactly ACK. Do not use tools.",
  "passToken": "ACK",
  "notes": "Reply with exactly ACK. Do not use tools.",
  "tags": ["coding"]
}
```

行为：

1. 拒绝已存在 materials 或 item id；题号 `^PAIRED-TASK-[0-9]{2,}$`；题干须含终态词
2. 写 `bank/materials/<taskId>/prompt.txt`
3. 写 OFF/ON item（模板见 §6）
4. 将 id 追加进所选测试集的无插件 / 有插件两侧
5. 自动 `item validate`；失败整笔回滚
6. 返回详情

错误码：`400` 非法 id / 缺字段 / 题干不含终态词；`409` 已存在；`404` 任务不存在；`500` 写盘或校验失败（已回滚）。

---

## 6. 题库数据模型（阶段 B）

### 6.1 任务聚合键

- 优先：`intent.effect_pair`（如 `PAIRED-TASK-02`）
- 回退：materials 目录名；item id 去掉 `EVAL-B-` 前缀与 `-OFF`/`-ON` 后缀

### 6.2 新建 OFF/ON 模板要点

| 字段                | OFF                                                                       | ON                                                                     |
| :------------------ | :------------------------------------------------------------------------ | :--------------------------------------------------------------------- |
| id                  | `EVAL-B-<TASK>-OFF`（TASK-01 特例可保持历史命名，新建一律带完整 TASK 段） | `EVAL-B-<TASK>-ON`                                                     |
| freeze.host_profile | `hosted-plain-v1`                                                         | `hosted-plugin-v1`                                                     |
| intent.effect_pair  | `<TASK>`                                                                  | 同左                                                                   |
| stimulus.ref        | `bank/materials/<TASK>/prompt.txt`                                        | 同左                                                                   |
| tags                | 任务类型（可选；禁止 paired / plugin-* / effect）                 | 同左                                                                   |
| ON 额外             | —                                                                         | `protocol_probes: [assistant_completed]`；`requires_durable_log: true` |

文件名：`bank/items/B/<kebab(id)>.item.json`。

### 6.3 保存与升版本

> **以 [09](09-bank-editor.md) 为准**：改题强制升版 + 必填变更说明；无 bump 开关。

---

## 7. UI 交互（阶段 B）

> **以 [09](09-bank-editor.md) 为准**：录题 4 步向导与改题页拆分；删除须手打题号。

```text
题库工作台
├── 页顶说明（3 行）
├── [录一道题] → 向导 dialog · [检查题库]
├── 题列表（点选）
└── 改题页：题干 / 怎样算对 / 变更说明 / [保存并升版本] / [删除…]
```

- 列表刷新在保存/录题/删除/校验后自动触发
- 不完整任务高亮（缺 OFF 或 ON）

测试任务区：

```text
测试任务
├── 列表（点选 / 新建 / 删除）
└── 当前任务：名称 · 只读类型 · 测试集 ·（测万象术才有）有无插件
    · 本题要跑的题目（勾选 + 简介 + 题干）
    · 已验证模型 / Agent / 万象术路径 · 高级 · [运行测试] · 日志
运行环境页
├── 模型清单（新增 / Hello World 验证）
└── Agent 清单（新增 / Hello World 验证）
测试结果
├── 跑次下拉（默认最近一次）
├── 明细（矩阵）
└── 分析（Δ / CONTEXT / 归因 / 对照）
```

---

## 8. 安全与技术

- 仅绑定 `127.0.0.1`；`safeUnder` 约束读写根
- 零新 npm 依赖；静态 HTML/CSS/JS + `server.ts` + `bank.ts` + `eval-tasks.ts`
- `apps/console/*.ts` 纳入 typecheck / eslint；`public/` 静态资源不 lint
- `eval-tasks/*.json` 含本机路径，不入库（gitignore）

---

## 9. 验收

### 测试任务 / 测试结果

- [x] `npm run console` 可开页
- [x] 三实验可触发（真跑需本机环境）
- [x] 测试结果：`dashboard`（配置条 / 矩阵 / 剔除后 Δ）
- [x] 可保存多条测试任务；类型创建后只读；测万象术才见有无插件
- [x] 本题要跑的题目可见简介与题干
- [x] 测试结果默认最近一次；可切换历史跑次
- [x] 勾选不写回测试集
- [x] 顶栏测试 | 题库 | 运行环境；测试集下拉无文件名；已验证模型/Agent 下拉
- [x] 录题必选测试集；题库按测试集筛
- [x] Hello World 验证后才进任务下拉

### 阶段 B

- [x] 列表展示现有配对任务（人话版本/完整度）
- [x] 改题强制升版 + 变更说明；终态词⊂题干
- [x] 录题向导落盘 + 组卷引用 + 失败回滚
- [x] 删除须手打题号；清资产与组卷
- [x] 检查题库按钮跑通且绿（含 summary）
- [x] 路径穿越 / 非法 id / C-B-30～34 门禁
- [x] `npm run console:smoke` / CI L0

严格版细节与验收见 [09](09-bank-editor.md)。
