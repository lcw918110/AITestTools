# 03 · 评测操作台测试手册（含题库严格版）

| 字段 | 值                                                                                                                                                                             |
| :--- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 状态 | **现行**                                                                                                                                                                       |
| 日期 | 2026-09-09                                                                                                                                                                     |
| 依据 | [需求 02](../archive/v1-requirements/02-console-prd.md)、[需求 03](../archive/v1-requirements/03-bank-editor-prd.md)、[设计 08](../archive/v1-design/08-console-outline.md) / [09](../archive/v1-design/09-bank-editor.md) |
| 范围 | 测试任务 / 测试结果 / 题库 / 运行环境                                                                                                                                          |

产品三对象跑卷仍以 [01-wanxiangshu-ops.md](01-wanxiangshu-ops.md) 为准；本文专测**操作台本身**。名词见 [术语篇](../00-glossary.md)。口径与打开的任务见 [../process/01-changelog.md](../process/01-changelog.md)。

---

## 0. 环境

```bash
export PATH="/usr/local/bin:$PATH"
cd /path/to/AITestTools
node -v                    # ≥22.22；推荐 24.18
npm run console            # http://127.0.0.1:8787
```

可选预填：

```bash
export SUT_ROOT=/path/to/wanxiangshu
export PROCTOR_HOSTED_MODEL=…   # 可选
```

| 级别            | 何时跑           | 依赖                                        |
| :-------------- | :--------------- | :------------------------------------------ |
| **L0 离线 API** | 每次改控制台必跑 | 无密钥、无 SUT                              |
| **L1 UI 冒烟**  | 发版前           | 浏览器打开本机页                            |
| **L2 直播编排** | 效果回归时       | `.env` + OpenCode +（插件实验需）`SUT_ROOT` |

---

## 1. L0 · 离线 API 用例

### 1.1 探活与元数据

| ID     | 步骤                   | 期望                                                                    |
| :----- | :--------------------- | :---------------------------------------------------------------------- |
| C-A-01 | `GET /api/health`      | `ok: true`，project 含 `product-eval`                                   |
| C-A-02 | `GET /api/presets`     | 含 `model` / `plugin` / `agent`；`defaultExamMode` / `defaultTestSetId` |
| C-A-03 | `GET /api/project`     | testSets≥3；含 `id`、`label`、`taskIds`；不含 eval-model 当测试集       |
| C-A-50 | `GET /api/test-sets`   | 含 `effect-smoke` / `calibrate` / `full`；无 `eval-model`               |
| C-A-51 | `GET /api/env/catalog` | 含从 rooms 抽出的 models / agents；有 `verifiedAt` 可空                 |

### 1.2 运行测试（离线）

| ID     | 步骤                                                                        | 期望                                         |
| :----- | :-------------------------------------------------------------------------- | :------------------------------------------- |
| C-A-10 | `POST /api/run` `{experiment:"plugin",live:false}`                          | `202` + `jobId`；轮询至 `done`，`exitCode=0` |
| C-A-11 | `POST /api/run` `{experiment:"model",live:false}`                           | job `done`（跑 demo-schema fixture）         |
| C-A-12 | `POST /api/run` `{experiment:"agent",live:false}`                           | job `done`（校验题库）                       |
| C-A-13 | `POST /api/run` `{experiment:"nope"}`                                       | `400`                                        |
| C-A-14 | `POST /api/run` `examMode:"maybe"`                                          | `400`                                        |
| C-A-15 | `POST /api/run` `taskIds:[]`                                                | `400`                                        |
| C-A-16 | `POST /api/run` plugin + live:false + 合法 `testSetId`/`taskIds`/`examMode` | 仍 `done`（离线不跑 hosted；不写回测试集）   |
| C-A-17 | `POST /api/run` model 或 agent + `examMode:"both"`                          | `400`（有无插件只属于测万象术）              |

### 1.2b 测试任务 CRUD

| ID     | 步骤                                                              | 期望                                      |
| :----- | :---------------------------------------------------------------- | :---------------------------------------- |
| C-A-40 | `POST /api/eval-tasks` 合法 body（`kind:plugin` + 效果小样本）    | `201`；磁盘 `eval-tasks/<id>.json`        |
| C-A-41 | `GET /api/eval-tasks`                                             | 含刚建的 `id`；`taskIds` 为人题号         |
| C-A-42 | `PUT /api/eval-tasks/:id` 改名称                                  | `200`；再 GET 见新名称                    |
| C-A-43 | `POST /api/eval-tasks` `kind:model` 且 `examMode:both`            | 仍可建（examMode 被忽略或存为 off）       |
| C-A-44 | `DELETE /api/eval-tasks/:id`                                      | `200`；列表不再出现（测完删，不留脏文件） |
| C-A-45 | `PUT /api/eval-tasks/:id` 改 `kind`                               | `400`（类型创建后只读）                   |
| C-A-46 | 任务 JSON 可存已验证 `model` / `agent` 快照                       | 真跑才校验已验证；离线可不选              |
| C-A-52 | `POST /api/env/models` 后 catalog 含该 id；`VERIFY_STUB` 验证通过 | 未验证不进入「任务可用」列表              |
| C-A-53 | `POST /api/test-sets` 新建 → 成对 paperset 文件空名单             | GET test-sets 可见                        |

### 1.3 结果读取

| ID     | 步骤                                                              | 期望                                                                                       |
| :----- | :---------------------------------------------------------------- | :----------------------------------------------------------------------------------------- |
| C-A-20 | `GET /api/runs`                                                   | `runs` 为数组（可为空）                                                                    |
| C-A-21 | 若有 run：`GET /api/runs/view?path=<绝对或相对 runs 子路径>`      | 含 `dir`；metrics/effect 可为 null；含 `summary.attribution` 与 `dashboard`（配置条/矩阵） |
| C-A-22 | `path=../../../etc/passwd`                                        | `404` 或不越界                                                                             |
| C-A-30 | `GET /api/baselines`                                              | 含 `baselines` 数组                                                                        |
| C-A-31 | `POST /api/baselines/pin` + `POST /api/compare`（临时名，测完删） | pin `ok`；compare 返回 `report.effect`                                                     |

### 1.4 题库列表与详情

| ID     | 步骤                                 | 期望                                                                                                |
| :----- | :----------------------------------- | :-------------------------------------------------------------------------------------------------- |
| C-B-01 | `GET /api/bank/tasks`                | ≥156 任务；`PAIRED-TASK-02.complete===true`，`passToken==="yes"`；有 `versionLabel`/`completeLabel` |
| C-B-02 | `GET /api/bank/tasks/PAIRED-TASK-02` | 含 prompt、`passToken`（及兼容 `hosted_pass_token`）、`offId`/`onId`、off/on rev                    |
| C-B-03 | `GET /api/bank/tasks/NO-SUCH`        | `404`                                                                                               |

### 1.5 编辑与校验（强制升版本）

准备：备份 `PAIRED-TASK-01` 的 prompt（测完还原）。

| ID     | 步骤                                                         | 期望                                 |
| :----- | :----------------------------------------------------------- | :----------------------------------- |
| C-B-10 | `PUT .../PAIRED-TASK-01` 改 prompt，带 `changeName`（≥4 字） | `200`；磁盘 prompt 已变；两侧 rev +1 |
| C-B-11 | `POST /api/bank/validate`                                    | `exitCode===0`；响应含人话 `summary` |
| C-B-12 | 改 `passToken`（OFF+ON 同步），含 `changeName`               | 两 item `rev` 再增；validate 仍绿    |
| C-B-13 | `PUT` 非法 `taskId` 含 `..`                                  | `400`                                |
| C-B-14 | **还原** TASK-01 prompt/token（再 PUT + changeName）         | 工作区干净或仅有意变更               |

### 1.6 新建 / 删除闭环

| ID     | 步骤                                                            | 期望                                                    |
| :----- | :-------------------------------------------------------------- | :------------------------------------------------------ |
| C-B-20 | `POST /api/bank/tasks` 创建下一空号（含 `testSetId`；测完删除） | `201`；materials+2 items 存在；自动校验绿               |
| C-B-21 | 检查测试集                                                      | 只挂所选测试集两侧；**不**进 156 全量（除非所选即全量） |
| C-B-37 | POST 无 `testSetId`                                             | `400`                                                   |
| C-B-22 | `POST /api/bank/validate`                                       | `exitCode===0`                                          |
| C-B-23 | 再次 POST 同 id                                                 | `409`                                                   |
| C-B-24 | `DELETE` + body `{confirmId:...}`                               | `200`；资产与测试集引用清除；随后 validate 绿           |

### 1.7 严格门禁（设计 09）

| ID     | 步骤                                                       | 期望                                     | 勾选 |
| :----- | :--------------------------------------------------------- | :--------------------------------------- | :--- |
| C-B-30 | 终态词不在题干 → POST/PUT                                  | `400`，提示写进题干                      | [x]  |
| C-B-31 | PUT 无 `changeName` 或 trim 后 &lt;4 字                    | `400`                                    | [x]  |
| C-B-32 | 录题校验失败 → 回滚                                        | 无残留 materials/item/测试集引用（单测） | [x]  |
| C-B-33 | DELETE 无 `confirmId` 或错号                               | `400`                                    | [x]  |
| C-B-34 | 题号非 `^PAIRED-TASK-[0-9]{2,}$`（如 `PAIRED-TASK-L0TMP`） | POST `400`                               | [x]  |
| C-B-35 | 题干含 Text-only / Do not use tools                        | POST `400`                               | [x]  |
| C-B-36 | 终态词与已有题撞名                                         | POST `400`                               | [x]  |

一键回归：`npm run console:smoke`（覆盖 C-B-30～36 中的 API 条 + 新建/删除 157）。

题库资产离线 smoke（无密钥）：

```bash
npm run validate:product-eval
# 期望：312/312（156 对 OFF/ON）通过
npm run eval:paired   # 无 PROCTOR_EVAL_LIVE 时跳过直播
```

---

## 2. L1 · UI 冒烟

| ID     | 步骤                                                        | 期望                                                                   |
| :----- | :---------------------------------------------------------- | :--------------------------------------------------------------------- |
| C-U-01 | 打开首页                                                    | 顶栏「测试 \| 题库 \| 运行环境」；默认测试页                           |
| C-U-02 | 新建「测万象术」任务、高级勾「只检查题库」、运行测试        | 日志出现 validate；状态完成                                            |
| C-U-07 | 测万象术可见无插件/有插件/同时跑；测模型不见该项            | 测万象术默认「同时跑」；详情页类型只读、无三选一                       |
| C-U-08 | 换测试集为效果小样本后列表为 157–159                        | 每行有任务类型、简介与题干；勾选不写回测试集；下拉无 paired-off 文件名 |
| C-U-11 | 运行环境页新增/验证模型或 Agent 后，测试任务下拉可见        | 未验证项不出现在任务下拉；任务页无自由输入                             |
| C-U-12 | 题库按测试集筛；录题第 1 步必选测试集                       | 可新建测试集再录                                                       |
| C-U-03 | 打开一条已有跑次的测试任务                                  | 测试结果默认最近一次：明细矩阵 + 分析（Δ / CONTEXT）                   |
| C-U-09 | 同一任务下若有多次跑次，切换更早一次                        | 明细与分析跟着换，不丢历史                                             |
| C-U-04 | 题库选 TASK-02，改 notes + 变更说明 → 保存并升版本          | 状态成功；rev 增加；再点开仍见新 notes                                 |
| C-U-05 | 检查题库                                                    | 大字 summary；日志可折叠                                               |
| C-U-06 | 录题向导建临时题后手打题号删除                              | 列表不再出现该任务                                                     |
| C-U-10 | 向导 4 步可走完；第 3 步可选任务类型；同屏无新建+编辑双表单 | 录题用 dialog；改题页无「新建」块；列表可见任务类型                    |

---

## 3. L2 · 直播编排（可选）

前置同 [01](01-wanxiangshu-ops.md) §1。

| ID     | 步骤                                         | 期望                                           |
| :----- | :------------------------------------------- | :--------------------------------------------- |
| C-L-01 | UI：测模型任务 + 已验证模型/Agent + 运行测试 | job done；跑次出现在该任务下                   |
| C-L-02 | UI：测万象术 + 真跑 + 万象术仓库路径         | 走 `eval:paired`；最新 run 可有 effect_compare |
| C-L-03 | UI：测 Agent + 运行测试                      | job done                                       |

失败时看 job 日志与 `results.ndjson` attribution，不归因为操作台除非 spawn/路径错误。

---

## 4. 回归命令清单（复制即跑）

```bash
BASE=http://127.0.0.1:8787

curl -s "$BASE/api/health" | head
curl -s "$BASE/api/presets" | head
curl -s "$BASE/api/bank/tasks" | head

# 离线有无插件
JOB=$(curl -s -X POST "$BASE/api/run" -H 'content-type: application/json' \
  -d '{"experiment":"plugin","live":false}' | python3 -c 'import sys,json;print(json.load(sys.stdin)["jobId"])')
echo "job=$JOB"
# 轮询至 done/error
curl -s "$BASE/api/jobs/$JOB" | python3 -c 'import sys,json;j=json.load(sys.stdin);print(j["status"],j.get("exitCode"))'

curl -s -X POST "$BASE/api/bank/validate" | python3 -c 'import sys,json;j=json.load(sys.stdin);print(j.get("exitCode"), j.get("ok"), j.get("summary"))'

# 或一键：
npm run console:smoke
```

---

## 5. 缺陷判定

| 现象                            | 归操作台                     | 归引擎/环境 |
| :------------------------------ | :--------------------------- | :---------- |
| API 4xx/路径穿越                | ✅                           |             |
| job 无法启动 / 日志不更新       | ✅                           |             |
| validate 红但 CLI 同命令绿      | ✅                           |             |
| LIVE 模型失败、NDJSON 缺        |                              | ✅          |
| 终态词与 prompt 不一致导致 FAIL | 题库内容（编辑器只负责落盘） |             |

---

## 6. 相关

- 产品操作：[01-wanxiangshu-ops.md](01-wanxiangshu-ops.md)
- 引擎回归：[02-engine-regression.md](02-engine-regression.md)
- 需求/设计：[../archive/v1-requirements/03-bank-editor-prd.md](../archive/v1-requirements/03-bank-editor-prd.md) · [../archive/v1-design/09-bank-editor.md](../archive/v1-design/09-bank-editor.md)
- 实现：`apps/console/`
