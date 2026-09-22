# 测试手册：万象术 · 模型 · Agent（操作级）

| 字段   | 值                                           |
| :----- | :------------------------------------------- |
| 状态   | **现行（测试主入口）**                       |
| 日期   | 2026-08-31（hosted 真跑转绿 + 配对对照收敛） |
| 合并自 | `wanxiangshu-ops` + `product-eval-guide`     |
| 引擎   | `agent-proctor` / `proctor`                  |

本文 = **原则 + 照做步骤**。名词见 [术语篇](../requirements/00-glossary.md)；引擎 A/B/C 自测见 [engine-regression](02-engine-regression.md)；需求见 [PRD](../requirements/01-prd.md)；当前口径与任务见 [过程日志](../process/01-changelog.md)。

---

## 0. 原则：三种测试对象

一次实验只变一个主因子（对象定义见术语篇「三种实验」）：

| 对象               | 固定什么                           | 变什么        | 要看什么                           |
| :----------------- | :--------------------------------- | :------------ | :--------------------------------- |
| **① 模型**         | 同一 Agent、同一任务、插件策略固定 | `model_id`    | 任务效果、服从率、可选质量分       |
| **② Agent**        | 同一模型、同一任务、插件策略固定   | 宿主产品/版本 | 契约是否仍成立、同任务效果是否漂移 |
| **③ 万象术类插件** | 同一 Agent、同一模型、同一任务     | 插件关 / 开   | 有插件是否更好（效果 + 可选分差）  |

**工具**：支撑面（解释 TOOL、壳契约）；经 Agent 的工具效果计入上表任务结果。

跑起来更重要：① **题库**（输入+判定）② **效果结果**（分列对比）③ **测试打分**。

产品效果资产在 `examples/product-eval`。磁盘布局见该目录 README。**操作台**说「测试集 / 运行环境」；本文 CLI 步骤仍用组卷 / 考场文件名（同一套磁盘资产）。

三种实验共用同一套任务，只换组卷与考场。测万象术推荐顺序：**先工程回归（Fold/C）→ 再有无插件效果配对**。

本地也可打开操作台（测试 | 题库 | 运行环境）：

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

ls "$SUT_ROOT/dist/OpenCode/Plugin/Plugin.js"
# 万象术无独立 npm run build；在被测仓执行：npm install && dotnet tool restore && node scripts/build.mjs
# 2026-08-31：拉远端最新后整仓 Fable 编译通过（735 源文件 ~50s），Plugin 可完整 import
# 编译若报「运行 dotnet tool restore 以使 fable 可用」但 restore 又说成功：
#   多为 NUGET_PACKAGES 指向失效缓存。清 ~/.dotnet/toolResolverCache/1/{fable,fantomas} 并
#   export NUGET_PACKAGES="$HOME/.nuget/packages" 后重 restore
opencode --version               # 本机 1.18.5；万象术 devDep 1.18.18（仍在 <1.19）

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

### 2.1 校准先行，再跑两层实验

**「过」现在判什么**：hosted 效果题主判定是 `expect.oracles` 里的 `workspace_assert`（工作区还在就跑，包括超时 / 非 0 / 空 stdout）。仓库全过 → 整题 PASS，即使超时或退出码非 0；超时与 `host_exit` 写入报告作辅助（类似暗号）。`hosted_pass_token` 只作**辅助信号**：报告写清「暗号：有/无」，缺词或空输出**不得一票否决**。`exit_code equals 0` 在超时/被杀时不单独否决。工作区失败 → `MODEL_TASK`（ON 题的 `attribution_focus: PROTOCOL` **不得**改写）；超时且文件没动 → `CONTEXT`。额度/真鉴权失败仍是 `CONTEXT`。PROTOCOL 只留给进程正常结束后探针 / EventStore 真缺。ON 额外要求 EventStore 里有 `RuntimeStarted` 与 `JournalEnvelope`（超时且工作区已过时探针未齐只记辅助）。冒烟 01–03 若几乎只靠回复文本过，不能当效果基线。

**校准（只跑 OFF，找当前模型会挂的题）** — 组卷 `paired-off-calibrate`（14 题，覆盖拒答 / 注入 / 格式 / 工具声明 / 运维判断，**不含** 01–03）。弱模型对照用 `paired-off-alt-calibrate`（考场 `hosted-model-alt-v1` / `agnes/agnes-2.0-flash`）：

```bash
export PATH="/usr/local/bin:$PATH"
export SUT_ROOT=/Users/Licw/Desktop/git/wanxiangshu
unset PROCTOR_HOSTED_PLUGIN
npm run proctor -- run --axis B --paperset paired-off-calibrate --project examples/product-eval
```

若加严后校准仍几乎全过 → **不要**把 156 对当效果实验；判定仍可能太松，或题仍是 Text-only 天花板。有稳定分差的题才进入实验 1。

**校准实测**

- **2026-08-31，旧暗号口径**：`paired-off-calibrate` run `20260831-182753303-ysvh`，基准模型 OFF **14/14 通过**（`model_source: room`，`model_matches_freeze: true`，约 9 分钟）。只判退出码 + 暗号，**不能当效果基线**。
- **2026-08-31，加严后弱 OFF**：`paired-off-alt-calibrate` run `20260831-192311756-4kud`，`agnes/agnes-2.0-flash` **13/14 通过**（`model_source: room`，`model_matches_freeze: false` 为实验 2 预期，约 2.3 分钟）。14 题进程均为退出码 0，无 CONTEXT/额度。唯一挂是 156：`stdout_assert refuse-adhoc`（回复用 “No—” 拒绝临时客户私聊，但当时拒答正则没覆盖该写法）——属判定假阴性，不是额度，也不是真去 ping 客户。该假阴性已用正则纳入 `No` / `No—` / `Nope` 修好；该 run 产物仍记录失败。弱模型对其余 13 题按题面作答且命中格式/拒答/schema 断言，**加严后仍偏松、不够测插件**（题仍是 Text-only，插件没有仓库/工具可发挥）。下一步若要确认强模型会不会也被 156 误杀，可跑 `paired-off-calibrate`；若要拉开插件差，需要能用工具/工作区的题，而不是再扫 156 对。

| 层              | 问什么                                      | 固定                                                | 只变        | 组卷（不要一上来 156） |
| :-------------- | :------------------------------------------ | :-------------------------------------------------- | :---------- | :--------------------- |
| **实验 1 效果** | 有万象术是否答得更好                        | OpenCode + 基准模型 `wave-anthropic/claude-sonnet-5` + 同一题 | 插件关 / 开 | `paired-off-effect-smoke` → `paired-on-effect-smoke` → `compare`（157–159；过程日志） |
| **实验 2 经济** | 弱模型+插件能否逼近强模型无插件；同任务耗时 | 同一批已能拉开差的效果题                            | 模型 ± 插件 | 见下表；**效果题拉开差之前不要跑** |

实验 2 四格（换弱模型：改对应 room 的 `host.model`，或换组卷；**不要**设 `PROCTOR_HOSTED_MODEL`，否则 `model_source` 不是 room）：

| 格      | 组卷                       | 考场                   | 模型（默认）            | 插件 |
| :------ | :------------------------- | :--------------------- | :---------------------- | :--- |
| 强 · 关 | `paired-off-calibrate`     | `hosted-plain-v1`      | `wave-anthropic/claude-sonnet-5`  | 无   |
| 强 · 开 | `paired-on-calibrate`      | `hosted-plugin-v1`     | 同上                    | 有   |
| 弱 · 关 | `paired-off-alt-calibrate` | `hosted-model-alt-v1`  | `agnes/agnes-2.0-flash` | 无   |
| 弱 · 开 | `paired-on-alt-calibrate`  | `hosted-plugin-alt-v1` | 同上                    | 有   |

典型对照：**弱+开 vs 强+关**（插件的经济价值）。`compare` 看通过率差；墙钟耗时读各题 `artifacts/<item>/hosted-run.json` 的 `duration_ms`（opencode CLI 不吐 token，`b_cost_tokens_per_pass` 在 hosted 面目前填不满）。alt 组卷相对题 `freeze.model_id` 会 `model_matches_freeze: false`——这是实验 2 预期，核 `model_source: room` 即可。

不要跑满 156 对当效果结论。现行效果小样本是 `paired-off-effect-smoke` / `paired-on-effect-smoke`（157–159，必须改仓库）。口径见 [过程日志](../process/01-changelog.md)。

### 2.2 一键

`eval:paired` 仍是 **156 对** 全量（off→pin→on→compare）。**不要**为效果结论跑这一条；校准未通过前也不要 `PROCTOR_EVAL_LIVE=1`。

```bash
cd /Users/Licw/Desktop/git/AITestTools
export SUT_ROOT=/Users/Licw/Desktop/git/wanxiangshu
unset PROCTOR_HOSTED_PLUGIN

npm run eval:paired                         # 校验 + 模型 fixture（不真跑）
# PROCTOR_EVAL_LIVE=1 npm run eval:paired   # 不要为效果结论跑全量
```

### 2.3 逐步手跑（实验 1：效果小样本 157–159）

现行组卷是 `paired-*-effect-smoke`，不是校准 14 题。命令见本节与 [过程日志](../process/01-changelog.md)。

```bash
PROJECT=examples/product-eval
npm run proctor -- item validate --project "$PROJECT" --check-fixtures

npm run proctor -- run --axis B --paperset paired-off-effect-smoke --project "$PROJECT"
OFF=examples/product-eval/runs/<OFF_ID>

npm run proctor -- run --axis B --paperset paired-on-effect-smoke --project "$PROJECT"
ON=examples/product-eval/runs/<ON_ID>

npm run proctor -- compare --baseline "$OFF" --candidate "$ON"
```

实验 2（效果题拉开差之后再做）：把上面的 paperset 换成 `paired-off-alt-calibrate` / `paired-on-alt-calibrate`；对照「弱+开 vs 强+关」时 baseline 用强 OFF run、candidate 用弱 ON run。

### 2.4 看结果

| 看哪里                       | 怎么用                                                             |
| :--------------------------- | :----------------------------------------------------------------- |
| 终端 `效果：pass_rate … Δ=…` | Δ>0 → on 通过率更高                                                |
| `$ON/effect_compare.md`      | 人读对照（含**配对效果**表）                                       |
| `results.ndjson`             | pass / attribution                                                 |
| `hosted-run.json`            | `plugin` 路径；`duration_ms`（经济）；`ndjson_health_signal=false` |
| `.wanxiangshu.ndjson`        | **已知失效**（0.8+ EventStore；不再当挂上插件）                    |
| `rubrics/effect-v1.json`     | 参考分 1–5 量表                                                    |

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

| 类型         | 现状                                                                                                                                                                     |
| :----------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 配对效果题   | `examples/product-eval/bank`：156 对 Text-only **不能当效果基线**；效果小样本 157–159 见 `paired-*-effect-smoke` |
| hosted smoke | `WX-B-HOSTED-PLUGIN-01`（万象术 papers）                                                                                                                                 |
| Fold/ST      | `st-import-L1`                                                                                                                                                           |

**更新原则**：改任务/成功标准 → off/on **同步** `bump-rev`；禁止把仅 on 侧协议事件写进 off 期望；打分量表变更单独版本化。

换任务：改 `bank/materials/PAIRED-TASK-01/prompt.txt` 与对应 item 的判定字段 → off/on **同步** `bump-rev` → 重跑。

### 2.7 hosted 真跑的环境约束（2026-08-31 实测）

**配置隔离**：hosted 真跑一律使用临时 `XDG_CONFIG_HOME`，只从你的 `~/.config/opencode/opencode.json` 继承 `provider` 段，不继承 `agent` 段。两个原因：

- 个人配置里的旧 agent 名（`build` / `coder` / `browser` / `reviewer` / `executor` / `meditator` 等 19 个）会让万象术 `managed-agent-config-invalid` 直接 fatal
- OFF/ON 必须只差插件一项，继承个人配置会让对照失去意义

**受管 agent**：万象术要求显式 `fast-` / `deep-` 前缀名，共 20 个（`fast-coder`、`deep-reviewer`…）。考场用 `host.managed_agents` 声明，引擎把它们统一绑到 `host.model`；`host.agent` 指定本次用哪个（现为 `fast-coder`）。OFF 侧同样声明，保证只变插件。

**git hooks 目录**：隔离工作区用空模板 `git init`，但必须补建 `.git/hooks`，否则万象术装 git hook 时 `durability-activation-failed`。引擎已处理。

**模型路由（已解决）**：万象术读 `$XDG_CONFIG_HOME/opencode/wanxiangshu.mjs` 作调度器，按角色分池覆盖 `-m`，默认池引用 `opencode-go` / `stepfun` / `cursor` / `neuralwatt` 等 provider，本机没有凭证会 `ProviderModelNotFoundError`。改被测仓的 `resources/wanxiangshu.mjs` 没用（那只是模板）。引擎现在在隔离配置目录里生成受控调度器，把**所有角色收敛到 `host.model` 一个目标**，于是 ON 侧模型不再由调度器决定，OFF/ON 只差插件一项。产物 `hosted-run.json` 的 `config_scheduler_model` 记下实际收敛目标。

**工作区隔离**：`room.workspace: "isolated"` 让每题跑在临时空 git 仓。挂插件的考场天然隔离，**无插件的对照侧必须显式声明**——否则 OFF 侧会落在项目根目录（能看到题库与引擎源码），ON 侧落在空仓，工作区内容与插件两个因子同时变。四个 hosted 考场均已声明；`hosted-run.json` 的 `workspace_isolated` 可核。隔离仓初始化后，会把本题 `stimulus.ref` 所在材料目录里除 `prompt.txt` 外的文件按相对路径拷进 workDir；空目录或只有 prompt 则仍是空仓（另有 README / opencode.json）。

**模型一致性**：`.env` 的 `PROCTOR_HOSTED_MODEL` 会静默盖掉 `room.host.model`，已注掉。产物记 `model_source`（`room` / `env`）、`model_frozen`、`model_matches_freeze`，跑完必须确认 `model_source: room` 且 `model_matches_freeze: true`。

**诊断**：真跑固定带 `--print-logs`，宿主日志全文落 `artifacts/<item>/hosted-stderr.log`。归因中 `HARNESS` / `CONTEXT` 不被题目 `attribution_focus` 改写——额度不足必须记成 `CONTEXT`，不得记成 `MODEL_TASK`。

**小规模先行**：`paired-off-smoke` / `paired-on-smoke`（各 3 题，同题号）只验证 LIVE 链路通（01–03 是 Text-only 天花板）。链路通之后跑 `paired-*-effect-smoke`（157–159），**不要**把冒烟全过或校准 14 题当效果基线，也**不要**开跑 156。

### 2.8 EventStore 的两个落点（2026-08-31 实测）

万象术运行时先把事件写 `<git-dir>/wanxiang/events/*.ndjson`（pending），只有 commit/push 触发 git hook 才收敛进 `refs/wanxiang/store`（ref）。**只读 ref 会把「插件正常工作但本题没碰 git」误判成插件没挂上**。引擎两处都读，按 `event_id` 去重，`hosted-run.json` 的 `event_store_source` 记来源（`ref` / `pending` / `ref+pending`）。

3 题 ON 侧实测命中 9 个 Kind：

```text
Agent  ChatExecution  Companion  Context  Host  JournalEnvelope  Prompt  Runtime  RuntimeStarted
```

156 道 ON 题的协议探针已从失效的 `assistant_completed` 换成 `RuntimeStarted` + `JournalEnvelope`（rev bump 已记 change_log）。OFF 侧不写协议探针。

---

## 3. 对象① · 模型

### 3.1 操作

与插件/Agent **同一套任务**（`product-eval` 的 `*-OFF` 题）：

```bash
# 产品效果：同题换模型（直播）
npm run eval:model
# 换模型：改 rooms/hosted-model-alt-v1.json 的 host.model，跑 eval-model-alt 或 paired-off-alt-calibrate
# 不要设 PROCTOR_HOSTED_MODEL（会静默盖掉考场，配对/经济对照失效）

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

- 产品效果：`examples/product-eval` · `eval-model` / `eval-model-alt`（156 OFF）；经济实验用校准 14 题：`paired-off-alt-calibrate`
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
npm run read:event-store -- /path/to/git-worktree   # 只读 refs/wanxiang/store；无则退出 2（运行时 pending 事件见 §2.8）
npm run smoke:coordinator          # 已知失效：退出 2（PluginWanxiangzhen 已消失）
npm run load:wanxiangshu-plugin    # 最小加载；Fable 产物不完整则退出 2
npm run smoke:plugin-fakehost      # 需完整 dist；当前不宣称绿
```

| 命令                                          | 2026-08-31 口径                                                                     |
| :-------------------------------------------- | :---------------------------------------------------------------------------------- |
| `smoke:wanxiangshu`                           | **只** C 真 git；**不再**含旧 L1 ST                                                 |
| `smoke:wanxiangshu:l1`                        | **可跑**：`foldEnvelope` + `RuntimeStarted`（3 题）                                 |
| `read:event-store`                            | **可跑（只读）**：解析 `refs/wanxiang/store`；无 tip 退出 2                         |
| `load:wanxiangshu-plugin`                     | **2026-08-31 转绿**：`dist/OpenCode/Plugin/Plugin.js` 可 import，导出 `{id,server}` |
| `hosted-smoke`                                | **2026-08-31 转绿**：真跑 1/1，EventStore 9 个 Kind（见 §2.8）                      |
| `paired-on-smoke` / `paired-off-smoke`        | **2026-08-31 各 3/3 通过**（01–03 Text-only 天花板）；效果题用 `paired-*-effect-smoke`（2026-09-01 权威跑次 0/3），不要跑 156 当效果 |
| `paired-off-alt-calibrate`                    | **2026-08-31 加严后 13/14**（弱模型 agnes-2.0-flash；156 为拒答正则假阴性）         |
| `smoke:coordinator`                           | 已知失效（万象阵已移除）                                                            |
| `.wanxiangshu.ndjson` / `assistant_completed` | 已知失效；hosted 改读 EventStore Fact（`RuntimeStarted` / `JournalEnvelope`）       |
| 旧 ST / Review / Nudge / Squad                | `st-import-L1` 标失效；未全改词                                                     |

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
- [ ] 本次主因子是：模型 / Agent / 插件（有无）/ 经济四格 / 仅回归
- [ ] 效果实验用 `paired-*-effect-smoke`（或同类必须改仓库的题），确认不是 01–03 / 156 Text-only 天花板；经济实验排在效果差出来之后

### 测后（效果配对）

- [ ] OFF / ON 两个 run
- [ ] 读过 `effect_compare.md`
- [ ] **不要**再用 on 侧 `.wanxiangshu.ndjson` / `assistant_completed` 当挂载验收；看 `hosted-run.json` 的 `event_store_present` / `event_store_source`（§2.8）
- [ ] 跑完核 `model_source: room`、`workspace_isolated: true`。实验 1（同模型 OFF/ON）还须 `model_matches_freeze: true`；实验 2（alt 考场）`model_matches_freeze` 预期为 false
- [ ] （可选）参考分 + 二次 compare

---

## 8. 路径速查与排错

| 资源            | 路径                                                                                                    |
| :-------------- | :------------------------------------------------------------------------------------------------------ |
| 配对考卷        | `examples/product-eval/`                                                                                |
| 任务 prompt     | `examples/product-eval/bank/materials/PAIRED-TASK-01/prompt.txt`                                        |
| 无/有插件 room  | `hosted-plain-v1` / `hosted-plugin-v1`；弱模型：`hosted-model-alt-v1` / `hosted-plugin-alt-v1`          |
| 校准 / 经济 / 效果组卷 | 校准 14：`paired-*-calibrate`（含 alt）；效果小样本：`paired-*-effect-smoke` |
| 插件产物        | `$SUT_ROOT/dist/OpenCode/Plugin/Plugin.js`（旧 `dist/Infrastructure/...` 仅回退）                       |
| 宿主日志全文    | `runs/<id>/artifacts/<item>/hosted-stderr.log`                                                          |
| 回归题库        | `examples/wanxiangshu-papers/`                                                                          |
| 脚本            | `scripts/eval-paired.sh`                                                                                |

| 症状              | 操作                                                        |
| :---------------- | :---------------------------------------------------------- |
| 无法执行 opencode | 修 PATH；`opencode --version`                               |
| on 无 EventStore  | 查 `hosted-run.json` 的 `event_store_*`；Plugin 须能 import |
| on 无 ndjson      | 预期：0.8+ 不再写 ndjson；勿当未挂载                        |
| off 也挂了插件    | `unset PROCTOR_HOSTED_PLUGIN`；确认 `paired-off`            |
| 鉴权失败          | 查 `.env`；归因 CONTEXT，勿改期望装绿                       |
| 解析不到 run 目录 | 看 `run 完成：` 行，改用手跑 §2.3                           |

### 能力速查

| 能力                      | 状态                                            |
| :------------------------ | :---------------------------------------------- |
| 模型 `eval-model`         | 有（fixture）                                   |
| Agent `eval-agent`        | 有（需网）                                      |
| 插件配对 off/on           | 有（效果小样本 157–159；不要把 156 Text-only 当效果基线） |
| 经济四格（弱/强 × 关/开） | 有（alt 考场 + 校准组卷；成本看 `duration_ms`） |
| 效果分列 / 参考分         | 有                                              |
| Fold + 真 git 回归        | 有                                              |
