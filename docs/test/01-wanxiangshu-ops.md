# 测试手册：万象术 · 模型 · Agent（操作级）

| 字段   | 值                                       |
| :----- | :--------------------------------------- |
| 状态   | **现行（测试主入口）**                   |
| 日期   | 2026-08-13（止血 + L1 + EventStore 归因） |
| 合并自 | `wanxiangshu-ops` + `product-eval-guide` |
| 引擎   | `agent-proctor` / `proctor`              |

本文 = **原则 + 照做步骤**。引擎 A/B/C 自测见 [engine-regression](02-engine-regression.md)；需求见 [PRD](../requirements/01-prd.md)；一次审核归档见 [../archive/design/32-…](../archive/design/32-product-eval-audit-2026-07-27.md)。

---

## 0. 原则：三种测试对象

一次实验只变一个主因子：

| 对象               | 固定什么                           | 变什么        | 要看什么                           |
| :----------------- | :--------------------------------- | :------------ | :--------------------------------- |
| **① 模型**         | 同一 Agent、同一任务、插件策略固定 | `model_id`    | 任务效果、服从率、可选质量分       |
| **② Agent**        | 同一模型、同一任务、插件策略固定   | 宿主产品/版本 | 契约是否仍成立、同任务效果是否漂移 |
| **③ 万象术类插件** | 同一 Agent、同一模型、同一任务     | 插件关 / 开   | 有插件是否更好（效果 + 可选分差）  |

**工具**：支撑面（解释 TOOL、壳契约）；经 Agent 的工具效果计入上表任务结果。

跑起来更重要：① **题库**（输入+判定）② **效果结果**（分列对比）③ **测试打分**。

产品效果资产在 `examples/product-eval`，结构为 **1 题库 + 考场/组卷/协议**：

```text
bank/materials + bank/items   → 题（输入 / 判定）
rooms/                        → 考场（有无插件、模型）
papersets/                    → 组卷（eval-model / paired-* / eval-agent）
protocol/rubrics/             → 参考分量表等
```

三种实验**共用同一套任务**，只换组卷与考场。测万象术推荐顺序：**先工程回归（Fold/C）→ 再有无插件效果配对**。

本地也可打开操作台（选型 / 一键跑 / 结果 / 题库编辑）：

```bash
npm run console   # http://127.0.0.1:8787
```

操作台专项用例：[03-console-ops.md](03-console-ops.md)。

---

## 1. 环境一次配好

```bash
export PATH="/usr/local/bin:$PATH"
node -v                          # 推荐 v24.18.x

cd /Users/Licw/Desktop/git/AITestTools
export SUT_ROOT=/Users/Licw/Desktop/git/wanxiangshu

ls "$SUT_ROOT/dist/Infrastructure/OpenCode/Plugin/Plugin.js"
# 万象术无独立 npm run build；在被测仓执行：dotnet tool restore && node scripts/build.mjs
# 2026-08-13：本机 Fable 整仓未绿，Plugin.js 可能写出但不完整（import 会缺模块）
opencode --version               # 本机 1.18.5；万象术 devDep 1.18.14（仍在 <1.19）

test -f .env && echo "已有 .env" || echo "请配置 .env（模型 API Key）"
unset PROCTOR_HOSTED_PLUGIN      # 配对 off 时勿强制挂插件
```

| 用途                            | `--project`                   |
| :------------------------------ | :---------------------------- |
| **产品效果**（模型/插件/Agent） | `examples/product-eval`       |
| Fold / 真 git 回归              | `examples/wanxiangshu-papers` |
| 引擎 schema fixture（CI）       | `examples/demo-project`       |

```bash
# 不要 sync:papers：万象术 0.8+ 已无 papers/；本地副本是 2026-07-27 冻结面
```

---

## 2. 对象③ · 万象术插件（主路径：有无对比）

### 2.1 实验设计

```text
固定：OpenCode + 同一模型 + 同一任务（materials/PAIRED-TASK-01）
只变：插件关（paired-off） / 开（paired-on）
看：终态「ok」、on 侧 NDJSON、可选人工分差
```

### 2.2 一键

```bash
cd /Users/Licw/Desktop/git/AITestTools
export SUT_ROOT=/Users/Licw/Desktop/git/wanxiangshu
unset PROCTOR_HOSTED_PLUGIN

npm run eval:paired                         # 校验 + 模型 fixture
PROCTOR_EVAL_LIVE=1 npm run eval:paired     # 真跑 off→pin→on→compare
```

### 2.3 逐步手跑

```bash
PROJECT=examples/product-eval
npm run proctor -- item validate --project "$PROJECT" --check-fixtures

npm run proctor -- run --axis B --paperset paired-off --project "$PROJECT"
OFF=examples/product-eval/runs/<OFF_ID>
npm run proctor -- baseline pin --run "$OFF" --name paired-off --project "$PROJECT"

npm run proctor -- run --axis B --paperset paired-on --project "$PROJECT"
ON=examples/product-eval/runs/<ON_ID>

npm run proctor -- compare \
  --baseline examples/product-eval/baselines/paired-off \
  --candidate "$ON"
```

### 2.4 看结果

| 看哪里                       | 怎么用                                          |
| :--------------------------- | :---------------------------------------------- |
| 终端 `效果：pass_rate … Δ=…` | Δ>0 → on 通过率更高                             |
| `$ON/effect_compare.md`      | 人读对照（含**配对效果**表）                    |
| `results.ndjson`             | pass / attribution                              |
| `hosted-run.json`            | `plugin` 路径；`ndjson_health_signal=false`     |
| `.wanxiangshu.ndjson`        | **已知失效**（0.8+ EventStore；不再当挂上插件） |
| `rubrics/effect-v1.json`     | 参考分 1–5 量表                                 |

| 现象            | 多半归因                                |
| :-------------- | :-------------------------------------- |
| 无 API / 未登录 | CONTEXT                                 |
| 有插件无 ndjson | **不再当未加载**；万象术已改 EventStore |
| 缺协议探针      | PROTOCOL                                |
| 协议正常无 `ok` | MODEL_TASK                              |

### 2.5 参考分（不进硬门禁）

量表见 `examples/product-eval/protocol/rubrics/effect-v1.json`。compare 会按 `*-OFF`/`*-ON` 或 `intent.effect_pair` 对齐分差。

```bash
npm run proctor -- score write --run "$OFF" --item EVAL-B-PAIRED-TASK-OFF --value 3 --max 5
npm run proctor -- score write --run "$ON"  --item EVAL-B-PAIRED-TASK-ON  --value 4 --max 5
npm run proctor -- compare --baseline "$OFF" --candidate "$ON"
# 或一键演示：
# BASE=… CAND=… npm run eval:score-demo
```

### 2.6 关注指标 / 用例 / 更新原则（插件）

| 指标                       | 用途                         |
| :------------------------- | :--------------------------- |
| 同任务通过率 on vs off     | 主效果                       |
| NDJSON 探针、步数（仅 on） | 过程                         |
| 工作区断言 on vs off       | 副作用                       |
| 参考分差                   | 打分叙事                     |
| Fold/C 通过率              | **自身**回归，不替代效果结论 |

| 类型         | 现状                                                                                                                                                                                                |
| :----------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 配对效果题   | `examples/product-eval/bank`：**156** 对（01～156；ROUND1～18；终态词见 [07 §1.2](../process/07-bank-coverage-analysis.md)；收束 [PIPELINE-DONE](../process/bank-ingest-staging/PIPELINE-DONE.md)） |
| hosted smoke | `WX-B-HOSTED-PLUGIN-01`（万象术 papers）                                                                                                                                                            |
| Fold/ST      | `st-import-L1`                                                                                                                                                                                      |

**更新原则**：改任务/成功标准 → off/on **同步** `bump-rev`；禁止把仅 on 侧协议事件写进 off 期望；打分量表变更单独版本化。

换任务：改 `bank/materials/PAIRED-TASK-01/prompt.txt` 与对应 item 的判定字段 → off/on **同步** `bump-rev` → 重跑。

---

## 3. 对象① · 模型

### 3.1 操作

与插件/Agent **同一套任务**（`product-eval` 的 `*-OFF` 题）：

```bash
# 产品效果：同题换模型（直播）
npm run eval:model
# 换模型：PROCTOR_HOSTED_MODEL=<id>  或  paperset eval-model-alt（改 rooms/hosted-model-alt-v1.json 的 host.model）

# 工程 schema fixture（CI，非产品效果题）
npm run eval:model:demo-schema
```

| 步  | 操作                                                         |
| :-- | :----------------------------------------------------------- |
| 1   | 固定 Agent、任务、插件关；只变模型                           |
| 2   | `eval-model` vs `eval-model-alt`；`baseline pin` + `compare` |
| 3   | 可选 `score write` 参考分                                    |

### 3.2 指标 / 用例 / 更新

| 指标                                         | 用途                      |
| :------------------------------------------- | :------------------------ |
| 任务通过率（按模型分列）                     | 主效果                    |
| 终态词 / NDJSON（若开插件）                  | 过程                      |
| `b_schema_obedience_rate`（仅 demo fixture） | 工程服从率                |
| 参考分                                       | 选型叙事；**不进硬 gate** |

- 产品效果：`examples/product-eval` · `eval-model` / `eval-model-alt`
- 工程 fixture：`examples/demo-project` · `eval-model` / `model-core`
- **更新**：改任务/成功标准 → `bump-rev`；只换模型 → 不升题 rev；禁止为弱模型单独放宽同一题

---

## 4. 对象② · Agent

### 4.1 操作

```bash
# 无插件宿主基线（需网）
npm run proctor -- run --axis B --paperset eval-agent --project examples/product-eval
# 或 demo
npm run proctor -- run --axis B --paperset eval-agent --project examples/demo-project

npm run proctor -- contract verify --host opencode@1.18.5
```

| 步  | 操作                                    |
| :-- | :-------------------------------------- |
| 1   | 固定模型与任务；切换 host / 版本        |
| 2   | 先 `contract verify`，再跑同任务 hosted |
| 3   | 对比效果与 PROTOCOL/CONTEXT 归因        |

### 4.2 指标 / 用例 / 更新

| 指标                     | 用途               |
| :----------------------- | :----------------- |
| 契约 probe               | Agent 面可测       |
| 同任务通过率（按 Agent） | 主效果             |
| PROTOCOL/CONTEXT 占比    | 宿主/上下文        |
| cassette（辅助）         | 边界回归，非效果分 |

- 现状：基本钉死 OpenCode；换 Agent 效果题库仍薄
- **更新**：一次只变 Agent；插件与模型与基线一致；契约失败不得改任务期望掩盖

---

## 5. 工程回归（不证明「更好」，证明「自身没坏」）

```bash
export SUT_ROOT=/Users/Licw/Desktop/git/wanxiangshu
npm run smoke:wanxiangshu          # 默认只跑 C 真 git（st-real-git）
npm run smoke:wanxiangshu:l1       # Journal.foldEnvelope 最小面（需 dist/Journal/Fold.js）
npm run read:event-store -- /path/to/git-worktree   # 只读 refs/wanxiang/store；无则退出 2
npm run smoke:coordinator          # 已知失效：退出 2（PluginWanxiangzhen 已消失）
npm run load:wanxiangshu-plugin    # 最小加载；Fable 产物不完整则退出 2
npm run smoke:plugin-fakehost      # 需完整 dist；当前不宣称绿
```

| 命令                                          | 2026-08-13 口径                                                          |
| :-------------------------------------------- | :----------------------------------------------------------------------- |
| `smoke:wanxiangshu`                           | **只** C 真 git；**不再**含旧 L1 ST                                      |
| `smoke:wanxiangshu:l1`                        | **可跑**：`foldEnvelope` + `RuntimeStarted`（3 题）                      |
| `read:event-store`                            | **可跑（只读）**：解析 `refs/wanxiang/store`；无 tip 退出 2              |
| `hosted-smoke`                                | **真跑阻塞**：Plugin import 缺 `PromptDispatcherSend.js`                 |
| `smoke:coordinator`                           | 已知失效（万象阵已移除）                                                 |
| `.wanxiangshu.ndjson` / `assistant_completed` | 已知失效；hosted 改读 EventStore Fact（`RuntimeStarted` / `JournalEnvelope`） |
| 旧 ST / Review / Nudge / Squad                | `st-import-L1` 标失效；未全改词                                          |

**回归绿 ≠ 有插件效果更好。**

---

## 6. 题库 · 效果 · 打分（横切）

| 层     | 约定                                                                                    |
| :----- | :-------------------------------------------------------------------------------------- |
| 题库   | 一题一意图；效果题用真实任务；配对/换模型/换 Agent 共用同一 `materials/`                |
| 效果   | `results.ndjson`、`metrics.json`、artifacts；`compare` → `effect` + `effect_compare.md` |
| 硬门禁 | 确定性 oracle                                                                           |
| 参考分 | `proctor score write` → `scores.json`（**不进硬门禁**）                                 |
| 分差   | `compare.effect`（通过率 / 指标 / 参考分）                                              |

---

## 7. 检查单

### 测前

- [ ] Node 24.x、`opencode` 可用
- [ ] `SUT_ROOT`；L1 需 `dist/Journal/Fold.js`（可部分产物）；Plugin 整仓 Fable 须绿才可 import
- [ ] `.env`；`unset PROCTOR_HOSTED_PLUGIN`
- [ ] 本次主因子是：模型 / Agent / 插件（有无）/ 仅回归

### 测后（效果配对）

- [ ] OFF / ON 两个 run
- [ ] 读过 `effect_compare.md`
- [ ] **不要**再用 on 侧 `.wanxiangshu.ndjson` / `assistant_completed` 当挂载验收；看 `event-store.json` / `refs/wanxiang/store`
- [ ] （可选）参考分 + 二次 compare

---

## 8. 路径速查与排错

| 资源           | 路径                                                             |
| :------------- | :--------------------------------------------------------------- |
| 配对考卷       | `examples/product-eval/`                                         |
| 任务 prompt    | `examples/product-eval/bank/materials/PAIRED-TASK-01/prompt.txt` |
| 无/有插件 room | `hosted-plain-v1` / `hosted-plugin-v1`                           |
| 回归题库       | `examples/wanxiangshu-papers/`                                   |
| 脚本           | `scripts/eval-paired.sh`                                         |

| 症状              | 操作                                             |
| :---------------- | :----------------------------------------------- |
| 无法执行 opencode | 修 PATH；`opencode --version`                    |
| on 无 EventStore  | 查 `hosted-run.json` 的 `event_store_*`；Plugin 须能 import |
| on 无 ndjson      | 预期：0.8+ 不再写 ndjson；勿当未挂载             |
| off 也挂了插件    | `unset PROCTOR_HOSTED_PLUGIN`；确认 `paired-off` |
| 鉴权失败          | 查 `.env`；归因 CONTEXT，勿改期望装绿            |
| 解析不到 run 目录 | 看 `run 完成：` 行，改用手跑 §2.3                |

### 能力速查

| 能力               | 状态                 |
| :----------------- | :------------------- |
| 模型 `eval-model`  | 有（fixture）        |
| Agent `eval-agent` | 有（需网）           |
| 插件配对 off/on    | 有（`product-eval`） |
| 效果分列 / 参考分  | 有                   |
| Fold + 真 git 回归 | 有                   |
