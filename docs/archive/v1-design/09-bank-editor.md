# 09 · 题库工作台设计（严格 · 易懂）

| 字段     | 值                                                                                                                               |
| :------- | :------------------------------------------------------------------------------------------------------------------------------- |
| 状态     | **已验收 · 现行**                                                                                                                |
| 日期     | 2026-09-09                                                                                                                       |
| 依据     | [需求 03](../v1-requirements/03-bank-editor-prd.md)；术语 [../v1-requirements/00-glossary.md](../v1-requirements/00-glossary.md) |
| 实现落点 | `apps/console/`（题库独立页；测试任务见需求 02 / 设计 08）                                                                       |

---

## 1. 设计原则

1. **一道题一个对象**：API 与 UI 的主键都是 `taskId`（题号），不是 item 文件名。
2. **人话标签**：题干 / 怎样算对 / 任务类型 / 版本 / 变更说明；协议字段只在高级只读区出现。
3. **严进严出**：非法输入不落盘；录题失败要回滚。
4. **少即是多**：主路径只有录、改、删、检查；不堆完整测试集编辑器。录题只选/新建一套测试集。

---

## 2. 页面结构

```text
顶栏：测试 | 题库 | 运行环境（本题库页）
┌─────────────────────────────────────────────┐
│ 题库工作台                                   │
│ 说明：用语见术语篇「题库」；三种实验共用同一套人题。 │
│ [录一道题]              [检查题库]           │
├──────────────┬──────────────────────────────┤
│ 题列表        │  右侧：改题页（点选后）        │
│ （含任务类型）│  或空态：「请选择或录一道题」   │
└──────────────┴──────────────────────────────┘

[录一道题] → 全屏/模态 4 步向导（盖住列表，避免同屏误操作）
```

### 2.1 列表行

| 列       | 来源                                                 |
| :------- | :--------------------------------------------------- |
| 题号     | `taskId`                                             |
| 怎样算对 | `hosted_pass_token`                                  |
| 版本     | `offRev` / `onRev`（展示为 `无插件 vN · 有插件 vM`） |
| 状态     | 完整 / 不完整（缺侧标红）                            |
| 任务类型 | item `tags`（仅任务类型；无则空）                    |

### 2.2 改题页字段

| UI 标签          | 写入                       | 校验                 |
| :--------------- | :------------------------- | :------------------- |
| 题干             | `prompt.txt`               | 非空；必须包含终态词 |
| 怎样算对         | OFF+ON `hosted_pass_token` | 格式；⊂ 题干         |
| 任务类型         | OFF+ON `tags`              | 可选；禁止废弃标签   |
| 变更说明         | bump-rev `--name`          | 长度 ≥ 4             |
| （高级）补充说明 | OFF+ON `notes`             | 可选                 |

保存按钮文案：**保存并升版本**（无复选框）。

删除：**删除这道题…** → 弹层输入题号 → 才调用 DELETE。

### 2.3 录题向导

步进组件；每步「下一步」前跑客户端校验；第 4 步只读预览：

```text
将创建：
- bank/materials/PAIRED-TASK-06/prompt.txt
- …/EVAL-B-PAIRED-TASK-06-OFF.item.json
- …/EVAL-B-PAIRED-TASK-06-ON.item.json
将挂入测试集：<所选测试集名称>
（不自动进 156 全量，除非所选即全量）
```

确认后：`POST /api/bank/tasks`（服务端事务）→ 成功提示 → 关闭向导 → 选中新题。

---

## 3. API（相对 08 的收紧）

保留路径前缀 `/api/bank/*`，行为加严如下。

### 3.1 创建 `POST /api/bank/tasks`

**请求**

```json
{
  "taskId": "PAIRED-TASK-06",
  "prompt": "Reply with exactly ACK. Do not use tools.",
  "passToken": "ACK",
  "notes": null,
  "tags": ["coding"],
  "testSetId": "calibrate"
}
```

| 字段        | 规则                                  |
| :---------- | :------------------------------------ |
| `taskId`    | `^PAIRED-TASK-[0-9]{2,}$`             |
| `prompt`    | 非空；必须包含 `passToken`            |
| `passToken` | `^[A-Za-z0-9_-]+$`                    |
| `notes`     | 可选；缺省则自动生成                  |
| `tags`      | 可选；任务类型，禁止废弃标签          |
| `testSetId` | **必填**；已有测试集 id，或先创建再录 |

**事务顺序**

1. 预检（存在性、格式、题干含词）→ 失败 `400`，无写盘
2. 写 materials → 写 OFF → 写 ON → 挂入所选测试集
3. `item validate --check-fixtures`
4. 若 3 失败：删除本笔 materials/items，并从测试集撤引用 → `500` + 日志
5. 成功 `201` + 详情

兼容：服务端仍接受旧字段名 `hosted_pass_token`（映射到 `passToken`），新 UI 只发 `passToken`。

### 3.2 保存 `PUT /api/bank/tasks/:taskId`

**请求**

```json
{
  "prompt": "…",
  "passToken": "ACK",
  "notes": "…",
  "tags": ["coding"],
  "changeName": "收紧终态词为 ACK"
}
```

| 规则                   |                                |
| :--------------------- | :----------------------------- |
| 无 `bumpRev` 字段      | **永远** bump OFF+ON           |
| `changeName`           | 必填，trim 后 ≥ 4              |
| 题干必须含 `passToken` | 否则 `400`                     |
| 历史特例题号           | 允许 PUT 内容，不允许改 taskId |

### 3.3 删除 `DELETE /api/bank/tasks/:taskId`

Body 可选（UI 用 query 亦可）：

```json
{ "confirmId": "PAIRED-TASK-06" }
```

`confirmId` 必须与路径题号完全一致，否则 `400`。

### 3.4 列表 / 详情

- 列表增加人话字段：`labelPassToken`、`versionLabel`、`completeLabel`（完整/不完整）
- 详情增加 `offId` / `onId` 只读，供高级区展示

### 3.5 校验 `POST /api/bank/validate`

响应增加：

```json
{
  "ok": true,
  "exitCode": 0,
  "summary": "10/10 试题通过",
  "log": "…"
}
```

`summary` 供界面大字展示；`log` 默认折叠。

---

## 4. 服务端模块

| 模块                         | 职责                                                               |
| :--------------------------- | :----------------------------------------------------------------- |
| `bank.ts`                    | 纯函数：校验题号/终态词/题干包含；create/update/delete；挂卷；回滚 |
| `bank-validate.ts`（可内联） | spawn validate，解析摘要                                           |
| `server.ts`                  | 路由；强制 `confirmId`；拒绝缺 `changeName` 的 PUT                 |

**回滚实现**：create 时记录 `createdFiles[]` 与 `papersetPatches[]`；失败则按记录逆序清理。

**终态词 ⊂ 题干**：`prompt.includes(passToken)`（严格子串；与 hosted `\b` 词边界不同——录入阶段用子串更易懂；题干写作规范要求终态词两侧有空格或标点，写入「录题提示」）。

---

## 5. 前端模块

| 文件                         | 职责                                                       |
| :--------------------------- | :--------------------------------------------------------- |
| `public/bank.js`（建议拆出） | 列表、改题、向导、删除确认                                 |
| `public/app.js`              | 测试任务 / 测试结果区；`import` 或并列加载 bank            |
| `index.html`                 | 题库区重排：说明 + 主按钮 + 列表 + 改题；向导用 `<dialog>` |

文案字典（唯一来源，禁止硬编码散落）：

| key        | 中文               |
| :--------- | :----------------- |
| prompt     | 题干               |
| passToken  | 怎样算对（终态词） |
| changeName | 变更说明           |
| save       | 保存并升版本       |
| create     | 录一道题           |
| validate   | 检查题库           |

---

## 6. 与测试任务的边界

- 题库工作台 **不** 触发跑卷，也 **不** 配置模型 / Agent。
- 录题/改题后，用户切到顶栏「测试」再跑。
- 页顶可放一行弱提示：「改完题后，去测试页开跑。」
- 模型 / Agent 只在运行环境页配置，任务页选用。

---

## 7. 测试（加严）

在 [03-console-ops.md](../test/03-console-ops.md) 增补（实现后勾选）：

| ID     | 期望                                   |
| :----- | :------------------------------------- |
| C-B-30 | 终态词不在题干 → POST/PUT 400          |
| C-B-31 | PUT 无 changeName → 400                |
| C-B-32 | 录题校验失败 → 无残留文件              |
| C-B-37 | POST 无 testSetId → 400                |
| C-B-38 | 录题只挂所选测试集，不自动进全量       |
| C-B-33 | DELETE 无 confirmId 或错号 → 400       |
| C-B-34 | 题号非 `PAIRED-TASK-NN` → 400          |
| C-U-10 | 向导 4 步可走完；同屏无新建+编辑双表单 |

`console:smoke` 须覆盖 C-B-30～34 中的 API 条。

---

## 8. 验收清单

- [x] 页顶说明 3 行，无协议黑话
- [x] 录题 4 步向导；失败回滚
- [x] 改题强制升版本 + 变更说明
- [x] 终态词必须出现在题干
- [x] 删除手打题号
- [x] 列表人话版本与完整度
- [x] L0 / `console:smoke` 加严全绿
- [x] 独立页；向导/列表/改题展示任务类型

---

## 9. 迁移说明

| 现行行为                    | 迁移                      |
| :-------------------------- | :------------------------ |
| UI `hosted_pass_token` 文案 | 改为「怎样算对」          |
| bump 复选框                 | 删除；永远 bump           |
| 同屏新建块                  | 移入向导                  |
| API 仅 `hosted_pass_token`  | 双接 `passToken`          |
| 松散 create                 | 加事务回滚 + 题号正则收紧 |

历史 TASK-01 特例：列表仍显示；改题允许；录题不可再造无数字后缀的 id。

---

## 10. 2026-09 第一刀：新题默认与门禁

不重做 CRUD。录/改/删/校验路径仍是「录一道题」四步向导 + `POST/PUT/DELETE /api/bank/tasks`。只改新建时写出什么、挂到哪、拒绝什么。

| 项         | 现行（新题）                                                                                                       |
| :--------- | :----------------------------------------------------------------------------------------------------------------- |
| 默认 notes | `Seal with <终态词>. Use the repo and tools when the task requires it.`（不再写禁工具）                            |
| ON 探针    | `RuntimeStarted` / `JournalEnvelope`（不再写 `assistant_completed`）                                               |
| 判定       | 至少 `exit_code` + 一条 `stdout_assert`；向导第 3 步可填「回复必须出现 / 禁止出现」（`contains` / `not_contains`） |
| 挂入测试集 | **只挂所选测试集**的无插件/有插件两侧；**不**自动进 156 全量                                                       |
| 题号       | 向导预填下一空号（现库为 `PAIRED-TASK-157`）                                                                       |
| 硬拒       | 题干含 Text-only / Do not use tools / Do not explore the repo；终态词与已有题撞名                                  |
| 冒烟例外   | API `allowSmokeTextOnly: true` 可放过禁工具题干；**默认关**，向导不暴露                                            |

`GET /api/bank/tasks` 增加 `nextTaskId`。删除仍会从校准卷 **与** 历史全量卷撤引用，避免旧题删不干净。

本刀不做：材料目录上传、hosted 工作区播种、裸编辑整份 item JSON、难度字段。向导第 3 步可选任务类型（`tags`）。
