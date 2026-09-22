# 三轴操作级测试手册（引擎工程回归）

| 字段     | 值                                                   |
| :------- | :--------------------------------------------------- |
| 状态     | **工程回归用**（非产品评测主视角）                   |
| 日期     | 2026-07-27                                           |
| 依据     | PRD 终稿 v2；papers-v1；本仓 CLI / 样例考卷          |
| 测试对象 | **A** 行为/事件/控制流 · **B** 模型 · **C** 工具 CLI |

> **测万象术 / 三对象请先看**：[wanxiangshu-ops](01-wanxiangshu-ops.md)  
> **本文**只描述引擎内部三轴如何自测/回归。

本文按引擎三轴，写到**可照做**的操作步骤、关注指标、用例形态与**更新原则**。协议细节见 [`../design/`](../design/)；过程收口见 [`../process/`](../process/)。

---

## 0. 总则（三对象共用）

### 0.1 一次 run 只变一个主因子

| 轴  | 主变化因子                       | 禁止混入（除非显式 `axis` 交集标注） |
| :-- | :------------------------------- | :----------------------------------- |
| A   | 事件/Fold/假宿主/契约/cassette   | 换模型、换真工具实现                 |
| B   | 模型 id / 通道（direct\|hosted） | 改 Fold 投影、改工具壳逻辑           |
| C   | 工具入参 / 壳实现                | 经 Agent 自由发挥答题                |

### 0.2 环境准备（操作前必做）

```bash
export PATH="/usr/local/bin:$PATH"   # 优先 Node 24.18（见 .node-version）
cd /path/to/AITestTools
node -v                              # 期望 v24.x
npm run verify                       # 引擎自检绿再测被测

# 万象术类题库（本仓副本）
export SUT_ROOT=/path/to/wanxiangshu   # Fold/Plugin 构建产物所在仓根
PROJECT=examples/wanxiangshu-papers

# 离线 demo（不依赖万象术）
PROJECT=examples/demo-project
```

密钥（仅 B live / hosted）：写入本地 `.env`（勿提交）。需网用例不得进默认 CI paperset。

### 0.3 通用产物与判读

每次 `proctor run` 写出：

```text
runs/<run_id>/
  run.json          # freeze、试题 rev、环境钉死
  results.ndjson    # 每题 pass/fail、attribution、oracle_failures
  metrics.json      # 聚合指标 + gates
  artifacts/        # 日志、workspace、NDJSON 副本
  report.md         # 人读；机器以 JSON 为准
```

失败必看：`results.ndjson` 中该题的 `attribution`（六选一）与 `oracle_failures[].evidence_ref`。

### 0.4 通用用例生命周期命令

```bash
# 校验 schema / 时间无关约束
npm run proctor -- item validate --project "$PROJECT"

# 新建骨架
npm run proctor -- item new --id MY-A-01 --axis A --layer L1 --project "$PROJECT"

# 语义变更后升 rev（勿静默改期望）
npm run proctor -- item bump-rev MY-A-01 --project "$PROJECT" --name "说明为何变严/变宽"

# 退役（deprecated，勿直接删历史基线依赖题）
npm run proctor -- item retire MY-A-01 --project "$PROJECT" --name "被 X 取代"

# 钉选 / 对比
npm run proctor -- baseline pin --run runs/<id> --name smoke-A-l1
npm run proctor -- compare --baseline baselines/smoke-A-l1 --candidate runs/<id>
npm run proctor -- report show --run runs/<id>
npm run proctor -- report trend --project "$PROJECT"   # 多 run 指标时间线（若已配置）
```

---

## 1. 测试对象 A：行为 / 事件 / 控制流

### 1.1 对象定义

| 层级   | 测什么                                                                   | 不测什么                                                                       |
| :----- | :----------------------------------------------------------------------- | :----------------------------------------------------------------------------- |
| **L1** | 领域投影：`Fold(events)` → 状态是否满足 `event_fold` / `state_predicate` | 真宿主 hook、真模型、真 git                                                    |
| **L2** | 契约假宿主上的控制流（nudge / review 时序、`event_subsequence`）         | MCP/真 session SDK 全真；可用 stubbed-ctx 加载真 Plugin（`smoke-A-L2-plugin`） |
| **L3** | cassette 对拍：录制带 vs 当前宿主边界行为                                | 当作主体覆盖（≤约 10% A 题量）                                                 |

**样例 paperset**：`smoke-A-L1` / `smoke-A` / `smoke-A-L3`（demo）；`st-import-L1`（万象术 ST→L1）。

### 1.2 操作级测试步骤

#### 情况 A1：L1 事件直测（主体）

| 步  | 操作                                                                                         | 期望                                                   |
| :-- | :------------------------------------------------------------------------------------------- | :----------------------------------------------------- |
| 1   | 确认 `rooms/*.json` 中 `fold_entry` 指向可 `import` 的 JS 产物；万象术需先在 `SUT_ROOT` 构建 | 路径存在且与 `freeze.fold_entry` / `event_schema` 一致 |
| 2   | 准备 `materials/<ITEM_ID>/stimulus.ndjson`（事件序）与 `expected-fold.json`（或 state 谓词） | `item validate` 通过                                   |
| 3   | 试题 `freeze.layer=L1`，`stimulus.kind=event_sequence`，`model_driver=none`                  | 无网络、`requires_network=false`                       |
| 4   | 执行：`npm run proctor -- run --axis A --paperset st-import-L1 --project "$PROJECT"`         | 进程 exit 0；gates 过                                  |
| 5   | 打开 `runs/.../results.ndjson`：每题 `pass=true`；失败则看 `PROTOCOL`/`CONTEXT` 与 fold diff | 无 `MODEL_*` 归因（L1 不应怪模型）                     |
| 6   | 同配置再跑一次，`compare` 归一化结果                                                         | `a_flaky_rerun_delta` 贡献为 0                         |

**万象术一键冒烟**：`npm run smoke:wanxiangshu` 现为 **C 真 git only**（需 `SUT_ROOT`）。L1 最小面见 `smoke:wanxiangshu:l1`（`foldEnvelope` + `RuntimeStarted`）。

#### 情况 A2：L2 契约假宿主（控制流）

| 步  | 操作                                                                                          | 期望                                                               |
| :-- | :-------------------------------------------------------------------------------------------- | :----------------------------------------------------------------- |
| 1   | `contracts/*.json` 与 room 的 fake-host 对齐；剧本在 `scripts/*.json`                         | `contract verify --host <id>` 相关 probe 绿（若适用）              |
| 2   | 试题 `freeze.layer=L2`，`model_driver=scripted`，引用 `script` + `stimulus.kind=hook_script`  | 剧本驱动轮次，无真 API                                             |
| 3   | Oracle 用 `event_subsequence` / `state_predicate` / `no_event` 钉时序，而非「某事件最终出现」 | 如 nudge 必须夹在两轮之间（见 demo `DEMO-A-NUDGE-TIMING-01` rev2） |
| 4   | `npm run proctor -- run --axis A --paperset smoke-A --project examples/demo-project`          | 全绿；artifacts 含 durable 会话痕迹（若 `requires_durable_log`）   |
| 5   | 改契约或剧本后：先 `item bump-rev`，再跑；旧 baseline 用 `compare` 看回归                     | 故意变严应导致旧 baseline 失败分类清晰                             |

#### 情况 A3：L3 cassette 对拍

| 步  | 操作                                                                                                      | 期望                                 |
| :-- | :-------------------------------------------------------------------------------------------------------- | :----------------------------------- |
| 1   | 录制：`PROCTOR_RECORD_CASSETTE=<id> npm run proctor -- run --axis A ...`（或专用录制入口，见 process/25） | `cassettes/<id>/manifest.json` 更新  |
| 2   | 试题 `freeze.layer=L3`，stimulus 指向 cassette                                                            | 回放不依赖外网（除非录制带本身要求） |
| 3   | `npm run proctor -- run --axis A --paperset smoke-A-L3 --project examples/demo-project`                   | 对拍 pass                            |
| 4   | 宿主大版本升级：优先改契约/L2；仅宿主边界漂移才重录 L3                                                    | 重录成本 O(边界题)，非整库           |

### 1.3 关注指标（A）

| 指标                      | 含义                    | 门禁建议               | 操作时怎么看                      |
| :------------------------ | :---------------------- | :--------------------- | :-------------------------------- |
| `a_case_pass_rate`        | active 题通过率         | smoke =1.0；full ≥0.98 | `metrics.json` + paperset `gates` |
| `a_invariant_violations`  | PROTOCOL/CONTEXT 归因数 | =0                     | 非 0 先修协议/夹具，再谈业务      |
| `a_recovery_pass_rate`    | 重启/重放类             | =1.0                   | 仅带 recovery 标签的子集          |
| `a_concurrency_pass_rate` | 竞争类                  | =1.0                   | 如 ST-05                          |
| `a_flaky_rerun_delta`     | 同配置重跑不一致        | =0                     | 连续两次 run + compare            |

单题可用 `metric_threshold` oracle 锁局部数值。

### 1.4 测试用例（A）形态与样例

**最小字段清单**：`id/rev/axis=A/status/title` · `intent` · `freeze.layer` · `stimulus` · `expect.oracles` · `metrics` · `execution` · `change_log`。

| 类型    | Oracle 组合                             | 仓库样例                                |
| :------ | :-------------------------------------- | :-------------------------------------- |
| L1 fold | `event_fold`                            | `WX-A-ST-01-MAIN`                       |
| L1 谓词 | `state_predicate` / `no_event`          | 设计 14；demo todo-fold 系列            |
| L2 时序 | `event_subsequence` + `state_predicate` | `DEMO-A-NUDGE-TIMING-01`、`review-pass` |
| L3 对拍 | cassette 相关 oracle                    | demo `l3-*` / `*-cassette`              |

**新建 L1 操作摘录**：

```bash
npm run proctor -- item new --id WX-A-ST-99 --axis A --layer L1 \
  --title "ST-99：…" --project "$PROJECT"
# 编辑 materials/WX-A-ST-99/{stimulus.ndjson,expected-fold.json}
# 把 id 写入 papersets/st-import-L1.json 的 items[]
npm run proctor -- item validate --project "$PROJECT"
npm run proctor -- run --axis A --paperset st-import-L1 --project "$PROJECT"
```

### 1.5 测试用例更新原则（A）

1. **领域不变量几乎不变**：业务规则变 → 改 `expected-fold` / 谓词，并 **`bump-rev`**，在 `change_log` 写清「变严/变宽/纠错」。
2. **控制流周级变**：优先改 L2 剧本与 subsequence；禁止用「最终出现某事件」掩盖时序错误。
3. **宿主月级变**：先 `contract verify`；契约变则更新 L2；仅边界题重录 L3，禁止整库升 cassette。
4. **禁止**把真模型噪声写进 A 期望；A 失败归因不应落到 `MODEL_*`。
5. **退役**：旧题被新 ST 取代 → `item retire`，不要物理删除仍被 baseline 引用的 id。
6. **Flaky**：先修刺激确定性（去裸 sleep、固定 seed/事件序），再改期望；连续 flaky 不得靠放宽 oracle 蒙混。

---

## 2. 测试对象 B：模型（direct / hosted）

### 2.1 对象定义

| 通道       | 测什么                                                               | 主指标 / 门禁                                 |
| :--------- | :------------------------------------------------------------------- | :-------------------------------------------- |
| **direct** | 模型对工具 schema / 必调工具 / 任务断言的服从（经 promptfoo 等适配） | 主指标；可设 `b_schema_obedience_rate` 等门禁 |
| **hosted** | 真宿主 + 插件写出 NDJSON 后的轨迹归因（实战对照）                    | **对照**；**禁止**挂硬门禁                    |

一次 run 钉死：`model_id`、`channel`、`host_profile`、`tool_profile`、prompt 模板。

### 2.2 操作级测试步骤

#### 情况 B1：B-direct（矩阵 / 服从率）

| 步  | 操作                                                                                                                        | 期望                                           |
| :-- | :-------------------------------------------------------------------------------------------------------------------------- | :--------------------------------------------- |
| 1   | 确认 room `model-direct-*`；工具用 **recorded fixture** 隔离工具实现                                                        | 失败归因可落在 `MODEL_SCHEMA` 等，而非工具 bug |
| 2   | 试题 `freeze.channel=direct`，`model_driver=live` 或 fixture 模式；`stimulus.kind=task_prompt`                              | `repeats` 默认 ≥3（减偶然）                    |
| 3   | Oracle：`tool_trace`（必调）+ `schema_obedience`（必填字段）；可选 `workspace_assert`                                       | 与 intent 的 `attribution_focus` 一致          |
| 4   | **离线 CI**：`npm run proctor -- run --axis B --paperset model-core --project examples/demo-project`（fixture）             | gates 过；无外网                               |
| 5   | **真模型**：配置 `.env` 后设 live（如 `PROCTOR_PROMPTFOO_LIVE=1` 或项目约定环境变量），`--models m1,m2`                     | 看 `b_*` 率；选型用，慎设绝对门禁              |
| 6   | 读 `metrics.json`：`b_schema_obedience_rate`、`b_required_tool_call_rate`、`b_invalid_args_rate`、`b_refusal_or_empty_rate` | 对比模型只比同一 paperset + 同一 fixture       |

#### 情况 B2：B-hosted（真宿主轨迹）

| 步  | 操作                                                                                        | 期望                                                                                 |
| :-- | :------------------------------------------------------------------------------------------ | :----------------------------------------------------------------------------------- |
| 1   | `SUT_ROOT` 指向被测仓；room `hosted-*` 能拉起真宿主 + 插件                                  | 宿主二进制可用                                                                       |
| 2   | 试题 `channel=hosted`，`requires_network=true`，`requires_durable_log=true`                 | 不进默认离线 CI                                                                      |
| 3   | `npm run proctor -- run --axis B --paperset hosted-smoke --project "$PROJECT"`              | exit 与 oracle（常为进程/`exit_code`）一致                                           |
| 4   | 检查 `hosted-run.json` 的 `event_store_present` / `event_store_source` + `event_store_kinds`；确认含探针 `RuntimeStarted` / `JournalEnvelope`（EventStore 读 `refs/wanxiang/store` + `pending` events） | 无 EventStore → 归因 **CONTEXT**（插件可能未挂或未触发 git）；有 EventStore 但缺探针 → **PROTOCOL**；探针正常仍错 → **MODEL_*** |
| 5   | 按设计 `12-hosted-attribution-tree` 分诊；**不得**把 hosted 聚合率写进 paperset 硬 gates    | `b_hosted_attribution_share` 仅报告                                                  |

#### 情况 B3：模型对比实验（操作约定）

| 步  | 操作                                                     | 期望                                  |
| :-- | :------------------------------------------------------- | :------------------------------------ |
| 1   | 固定 paperset、fixture、prompt、repeats；只改 `--models` | 单一主因子 = 模型                     |
| 2   | 两次 run `baseline pin` + `compare`                      | 报告只解释模型差，不混入工具/宿主变更 |
| 3   | 记录 token/步数等次要指标                                | 信息性，不作发布门禁                  |

### 2.3 关注指标（B）

| 指标                         | 通道   | 门禁          | 说明                  |
| :--------------------------- | :----- | :------------ | :-------------------- |
| `b_task_pass_rate`           | 分列   | 选型用        | 按 direct/hosted 分列 |
| `b_schema_obedience_rate`    | direct | 可 ≥0.9       | 仅 direct             |
| `b_required_tool_call_rate`  | direct | 按题库        | 与 `tool_trace` 对齐  |
| `b_invalid_args_rate`        | direct | lower better  |                       |
| `b_avg_steps_to_success`     | 双     | 信息性        |                       |
| `b_cost_tokens_per_pass`     | 双     | 信息性        |                       |
| `b_refusal_or_empty_rate`    | 双     | lower better  |                       |
| `b_hosted_attribution_share` | hosted | **禁止 gate** | 对照分布              |

### 2.4 测试用例（B）形态与样例

| 类型        | Oracle                            | 样例                                         |
| :---------- | :-------------------------------- | :------------------------------------------- |
| schema 服从 | `tool_trace` + `schema_obedience` | `DEMO-B-TOOL-SCHEMA-01`（及 02–05）          |
| hosted 冒烟 | `exit_code` + 日志探针            | `WX-B-HOSTED-PLUGIN-01`、demo `hosted-smoke` |

**新建 direct 题**：

```bash
npm run proctor -- item new --id DEMO-B-TOOL-06 --axis B \
  --title "必调 xxx 且字段齐全" --project examples/demo-project
# freeze.channel=direct；补 materials/.../task.md；挂入 model-core
```

### 2.5 测试用例更新原则（B）

1. **换模型 ≠ 改题**：模型矩阵变更只改 run 参数 / room 默认模型，不升题 rev。
2. **改 prompt / 必填字段 / 必调工具** → 必须 `bump-rev`，并说明对服从率的预期影响。
3. **工具实现变更**：direct 仍用 recorded fixture；真工具回归放到 **C 轴**，禁止用 B 题背锅。
4. **hosted**：协议探针随插件 NDJSON schema 变而更新；归因树变更走设计评审，不把偶然 PASS 写成门禁。
5. **repeats**：减噪靠重复与 fixture，不靠单次运气放宽 oracle。
6. **密钥/配额失败**：应诚实红并归因基础设施/CONTEXT，禁止改期望「跳过」。

---

## 3. 测试对象 C：工具（CLI 壳）

### 3.1 对象定义

直调每工具独立 CLI 壳（子进程）：验证 **契约输出、边界、幂等、副作用**。不经 Agent 自由规划。

**样例**：demo `smoke-C-echo` / `smoke-C-write`；万象术 `st-real-git`（ST-06/09/12/16）。

### 3.2 操作级测试步骤

#### 情况 C1：契约正常路径

| 步  | 操作                                                                                      | 期望                              |
| :-- | :---------------------------------------------------------------------------------------- | :-------------------------------- |
| 1   | room 声明壳命令（如 `shells/*.mjs`）；`freeze.tool_profile` 对应工具名                    | 壳可独立 `node shells/….mjs` 试跑 |
| 2   | `stimulus.kind=tool_args`，`materials/.../stimulus.json` 给出合法入参                     |                                   |
| 3   | Oracle：`exit_code` + `tool_result_equals`（和/或 stdout JSON 约定）                      | 深度相等或文档约定 JSONPath       |
| 4   | `npm run proctor -- run --axis C --paperset smoke-C-echo --project examples/demo-project` | `c_contract_pass_rate` 门禁过     |

#### 情况 C2：边界 / 非法输入 / 幂等

| 步  | 操作                                                                                                     | 期望                                                   |
| :-- | :------------------------------------------------------------------------------------------------------- | :----------------------------------------------------- |
| 1   | 另开试题：非法路径、空参数、重复调用同一副作用                                                           | tags 含 `boundary` / `idempotent`                      |
| 2   | Oracle：`exit_code` 非 0 或结构化错误字段；幂等则二次调用 `tool_side_effect` / `workspace_assert` 不变坏 | 与 intent 一致                                         |
| 3   | 独立 paperset 或同集 gates 分指标                                                                        | `c_boundary_pass_rate` / `c_idempotent_pass_rate` =1.0 |

#### 情况 C3：副作用与工作区（含真 git）

| 步  | 操作                                                                                                                                        | 期望                                          |
| :-- | :------------------------------------------------------------------------------------------------------------------------------------------ | :-------------------------------------------- |
| 1   | 壳在临时 workspace 执行；stimulus 描述初始 git/文件布局                                                                                     | 不污染用户实仓                                |
| 2   | Oracle：`workspace_assert`（文件存在/内容）+ `tool_side_effect` + 可选 `tool_result_equals`                                                 | 如 ST-06：`rebaseNeeded` + `rebasedAndMerged` |
| 3   | `export SUT_ROOT=...`（若壳依赖被测脚本）后：`npm run proctor -- run --axis C --paperset st-real-git --project examples/wanxiangshu-papers` | 6/6 类结果全绿                                |
| 4   | 超时/截断类：断言壳正确标记，而非「卡住算过」                                                                                               | `c_timeout_truncate_correct`                  |

### 3.3 关注指标（C）

| 指标                         | 含义                    | 门禁建议                   |
| :--------------------------- | :---------------------- | :------------------------- |
| `c_contract_pass_rate`       | 直调契约通过率          | =1.0                       |
| `c_boundary_pass_rate`       | 边界/非法输入           | =1.0                       |
| `c_idempotent_pass_rate`     | 幂等类                  | =1.0                       |
| `c_timeout_truncate_correct` | 超时/截断标记           | =1.0                       |
| `c_via_agent_discover_rate`  | 经 Agent 发现并正确调用 | 可选；属交叉轴，须显式标注 |

### 3.4 测试用例（C）形态与样例

| 类型         | Oracle                                  | 样例                   |
| :----------- | :-------------------------------------- | :--------------------- |
| echo 契约    | `exit_code` + `tool_result_equals`      | `DEMO-C-ECHO-01`       |
| 写文件副作用 | `workspace_assert` / `tool_side_effect` | `DEMO-C-WRITE-*`       |
| 真 git 流程  | 结构化 result + 工作区                  | `WX-C-ST-06-REBASE` 等 |

**新建 C 题**：

```bash
npm run proctor -- item new --id WX-C-ST-99 --axis C \
  --title "ST-99：…" --project "$PROJECT"
# 编写 shells 或复用 st-git.mjs；补 stimulus.json；挂 paperset
```

### 3.5 测试用例更新原则（C）

1. **壳协议变**（stdout JSON 字段、exit 语义）→ 全量相关题 `bump-rev`，并同步壳与 oracle。
2. **工具行为变严**（如 ff-only 更严）→ 更新 `tool_result_equals` / 工作区断言，禁止删断言装绿。
3. **可改 L1 覆盖的「工具改投影」**优先迁 A-L1；C 聚焦 IO/边界/幂等/截断（PRD 补充）。
4. **禁止**在 C 题里依赖活模型；`model_driver=none`。
5. **真 git / 实文件系统**：夹具必须自包含可重建；不得依赖开发者本机脏状态。
6. **交叉「经 Agent 调工具」**：单独 paperset，axis 标注 AC/BC，指标用 `c_via_agent_*`，不与纯 C 门禁混算。

---

## 4. 三对象对照速查

|             | A                           | B                                       | C                           |
| :---------- | :-------------------------- | :-------------------------------------- | :-------------------------- |
| 主命令      | `run --axis A --paperset …` | `run --axis B --paperset …`             | `run --axis C --paperset …` |
| 默认网络    | 否（L1/L2）                 | direct fixture 否；live/hosted 是       | 否                          |
| 主门禁      | `a_case_pass_rate` 等       | direct 的 `b_schema_*`；hosted 无硬门禁 | `c_*_pass_rate` =1.0        |
| 升 rev 时机 | 期望/时序/事件序变          | prompt/必调/schema 变                   | 壳协议/断言变               |
| 权威样例库  | `st-import-L1`、`smoke-A*`  | `model-core`、`hosted-smoke`            | `smoke-C-*`、`st-real-git`  |

### 推荐日常回归

```bash
npm run verify
npm run smoke:offline          # demo：A L1/L2/L3 + B fixture + C echo/write
SUT_ROOT=/path/to/wanxiangshu npm run smoke:wanxiangshu      # 仅 C 真 git
SUT_ROOT=/path/to/wanxiangshu npm run smoke:wanxiangshu:l1   # foldEnvelope 最小面
```

---

## 5. 相关文档

| 文档                                                                  | 用途                |
| :-------------------------------------------------------------------- | :------------------ |
| [02-protocol-papers-v1](../design/02-protocol-papers-v1.md)           | 试题/试卷 JSON 协议 |
| [03-fold-entry-contract](../design/03-fold-entry-contract.md)         | L1 Fold 入口        |
| [06-host-contract-schema](../design/06-host-contract-schema.md)       | L2 宿主契约         |
| [07-hosted-attribution-tree](../design/07-hosted-attribution-tree.md) | B-hosted 分诊       |
| [04-state-predicate](../design/04-state-predicate.md)                 | 谓词白名单          |
| [ADR-0008](../architecture/adr/0008-local-sut-papers-copy.md)         | 题库本地副本        |
| [01-wanxiangshu-ops](01-wanxiangshu-ops.md)                           | 测万象术（产品）    |
| PRD [`../requirements/01-prd.md`](../requirements/01-prd.md) 附录 B/C | Oracle 与指标总表   |
