# 过程日志（当前态）

| 字段       | 值                                                                                                       |
| :--------- | :------------------------------------------------------------------------------------------------------- |
| 角色       | **本栏唯一过程日志**。仓库文档只呈现当前口径；旧稿在 git 历史里                                          |
| 日期       | 2026-09-11                                                                                               |
| 关闭的门禁 | [02 解冻](02-unfreeze-checklist.md) · [03 Phase 1 DoD](03-phase1-dod.md) · [04 终审](04-final-review.md) |

产品需求 / 设计 / 测试手册以各栏现行正文为准，不在本日志里复述两套说法。名词与逻辑概念只在 [00-glossary.md](../requirements/00-glossary.md) 定义。

**开发过程（不是任务表里的项）：** Grill → 设计落盘 → 编码规范 → 自测 → 代码审查（本仓 skills，见 `AGENTS.md`）。T1–T7 同样走这套。

---

## 1. 当前产品口径

操作台三页与题 / 测试集 / 运行环境 / Δ 等词义见术语篇。本节只留**当前决策**：

- 给人筛卷用测试集（效果小样本 / 校准 / 全量 / 冒烟 / 自建），不用旧字段 `effect`，不下拉 `paired-off` / `eval-model` 等文件名。
- 可保存的**测试任务**承担原「模板」意向；不改 `eval:paired` 默认绑 156。类型只在新建时选，打开后只读。勾选是「本题要跑的题目」，不写回测试集。
- 权威效果小样本仍是 157–159。**T6 Grill 已对齐（§6）**：固定模型只变插件；直接改这三题直到 OFF 必挂、ON 有机会过；CONTEXT 不进结论。2026-09-01 对照曾 OFF/ON 均为 0/3，**改题重测前不能说插件更好**。不要把 156 全量当效果结论。
- 测模型 / 测万象术 / 测 Agent 互斥。无插件 / 有插件 / 同时跑只属于测万象术，是运行环境不是两套测试集。
- 界面：顶栏 **测试 | 题库 | 运行环境**。测试集 × 运行环境组合开跑。模型 / Agent 在运行环境页配置并 Hello World 验证后，任务只选已验证项并记下快照。录题必选或新建测试集。输入提示用中文（题号格式等协议值除外）。

---

## 2. 已落地（当前能用的）

- 引擎 hosted：隔离仓、材料播种、EventStore 探针、超时仍判工作区；暗号辅助
- 题库工作台：录/改/删/检查；新题挂校准卷；禁 Text-only 题干
- 选题：按测试集筛题目、测万象术整次有无插件三选一；勾选不写回测试集
- 试题 `tags`：已去掉 `paired` / `plugin-off` / `plugin-on` / `effect`；留下的是任务类型
- 录题向导：可选任务类型；OFF/ON 只按条目 id 识别；必选测试集（可新建）

- 测试任务 T1：按组卷文件名筛 + 勾选题目 + 任务类型
- 测试任务 T2：测万象术无插件 / 有插件 / 同时跑（测模型/测 Agent 不再出现该项）
- 测试任务 T3：可保存多条测试任务（选题+配置+跑次历史）
---

## 3. 任务（打开的）

| ID     | 看板 / 位置 | 做什么                                                                           | 不做                                        |
| :----- | :---------- | :------------------------------------------------------------------------------- | :------------------------------------------ |
| **T4** | 测试任务    | 用途字段（效果对照 / 校准 / 回归）                                               | 本刀不做                                    |
| **T5** | 题库        | ~~向导可选任务类型~~ **已落地**；~~录题选测试集~~ **本刀落地**；难度字段仍打开 | 完整测试集编辑器；本刀不录入难度 |
| **T6** | 效果实验    | **Grill 已对齐**（§6）：改 157–159，OFF 必挂、ON 有机会过；小规模对照；CONTEXT 不进结论 | 跑满 156 当效果；改万象术业务逻辑；本刀不做 T7 |
| **T7** | 测试结果    | 经济四格（弱开 vs 强关）；以后的「看板」再观察多次测试                           | 效果差出来之前不画空图                      |

---

## 4. 本轮文档与资产（2026-09-09）

- 操作台三页：测试 | 题库 | 运行环境；测试集 × 运行环境；录题挂所选测试集；模型/Agent 配置 + Hello World 验证
- 需求 02/03、设计 08/09、术语 00、测试 03、过程日志改为上一节口径
- 约束不变：不改 papers-v1、不改万象术、156 不当效果结论

---

## 5. 工程备忘（2026-09-11）

- **E1 多 Agent 密钥：** 项目 `.env` 不再把 LongCat `ak_` 填进 `OPENAI_API_KEY`；`OPENAI_*` 改指 DeepSeek 兼容端。OpenCode `agent.scout/task/build/coder/...` 已切 `ark/deepseek-v4-flash`。Cursor/Omp 内置 `scout` 仍可能把 `meituan` 的 `ak_` 打到 `api.openai.com`（忽略 `OPENAI_BASE_URL`）——子 agent 冒烟未绿，需宿主侧改模型/鉴权或提供真 OpenAI key。
- **E3 模块图：** `docs/00-repo-structure.md` 已补齐 `apps/console` 文件级地图（含 `test-sets` / `run-plan` / `dashboard` / `env-catalog` / `public/*`）。
- **T1–T3：** 已在「已落地」；打开的任务仅 T4–T7。
- **T6 Grill：** §6 已落盘共识与 DoD；157–159 题面与 `workspace_assert` 已收紧（Math.round 取整、端口对齐、查询解析等，见 item rev1），下一步是设计核对实验 1 入口并获取执行证据。

---

## 6. T6 Grill 共识与 DoD（2026-09-11）

**共识（用户「继续」确认建议方案）：**

- **实验对象：** ③ 万象术类插件（有无对比）
- **只变一个因子：** 固定同一 Agent（OpenCode）+ 同一基准模型（考场 `host.model` / `wave-anthropic/claude-sonnet-5`）；只变插件 OFF / ON
- **资产：** 直接改现有效果小样本 **157–159**（`paired-off-effect-smoke` / `paired-on-effect-smoke`），不新开题库、不先重跑校准全量挑题
- **目标形态：** 基准模型 **OFF 必挂**；**ON 有机会**靠工作区 / 工具过（非 Text-only 天花板）
- **结论纪律：** `CONTEXT`（额度、真鉴权失败、超时未动文件等）**不进**效果结论；156 全量不当效果；不改万象术业务逻辑

**本刀不做：** 重跑 `paired-off-calibrate` 当主路径；`eval:paired` / 156 对；T7 经济四格；改宿主侧 Cursor/Omp scout 鉴权（E1 阻塞另记）

**DoD（T6 可宣称本刀完成时）：**

1. 157–159 OFF/ON 题面与 `workspace_assert`（及必要材料）已收紧：题仍要求必须改仓库才能过
2. 至少跑通一轮小样本对照：`paired-off-effect-smoke` → `paired-on-effect-smoke` → `compare`（或等价操作台路径）
3. 报告可读出：**OFF 通过率 < ON**（在剔除 CONTEXT 之后）；若仍 0/0 或同分，不得宣称「插件更好」，须回到改题
4. 过程日志 / 测试手册口径与上述一致；未把 156 全量写进效果结论
5. 宣称完成前走 `sdlc-self-check`（至少 `format:check` + 相关校验；真跑有密钥时再记 run id）

**已知风险 / 未决（不阻塞写题，但阻塞「宣称插件更好」）：**

- 2026-09-01 对照 OFF/ON 曾均为 0/3——判定或题面仍可能过紧/过松，需改题后重测
- ON 侧 EventStore / Plugin 未齐时易落 PROTOCOL 或辅助信号缺失，需与「工作区已过」口径区分
- 基准模型额度 / 鉴权失败会刷 CONTEXT，不得当成 OFF 真挂

157–159 的 `workspace_assert` 已收紧（Math.round 取整、端口对齐、查询解析等、`not_contains` 防退化，见 item rev1）。

### 执行证据与结论（2026-09-22）

**运行环境：**
- 模型：`wave-anthropic/claude-sonnet-5`（通过 DeepSeek 兼容端）
- 代理：`fast-coder`
- 因子：仅变插件 OFF/ON（hosted-plain-v1 vs hosted-plugin-v1）
- 题面：157–159（rev1，已收紧 workspace_assert）

**执行结果（重跑轮次）：**

| Run | 方向 | 通过率 | 归因 |
|-----|------|--------|------|
| `20260922-162303606-yxmz` | OFF | 3/3 (100%) | 全部通过 |
| `20260922-162623069-xqs4` | ON | 0/3 (0%) | 全部 MODEL_TASK（host_exit=1） |

- Δ = -1.000（剔除 CONTEXT 后不变，无 CONTEXT 发生）
- `effect_compare.md` 已写入 ON run 目录下

**结论：**
- 插件未提升模型在 157–159 上的表现；OFF 全部通过、ON 全部失败
- 因 OFF >> ON（非 0/0 或同分归因），不满足「OFF 必挂、ON 有机会过」的目标形态
- 按 DoD 纪律：「若仍 0/0 或同分，不得宣称插件更好」——现证据更强（插件反降性能）
- 本实验不支持「万象术插件改善模型效果」的假设

**SDLC 自检：**
- `validate:product-eval`：318/318 PASS
- `typecheck`：无错误
- `vitest`：44 文件 213 测试全部通过
- `format:check`：通过（0 新增问题）

---

## 7. 补记与修复（2026-09-22）

**执行证据更正（T6 ON run）：**

- `20260922-162623069-xqs4`（ON，0/3，全部 MODEL_TASK host_exit=1）为**死循环强停**事件，不是普通答案错误。原 §6 执行证据节（执行证据与结论 2026-09-22）未注明这一事实。

**万象术修复：**

- 本次死循环强停后重新更新万象术（hosted-runner / l1 / l2 / l3-runner / fold-bridge 等 93 文件未提交改动，+2497/−2330 行），预计解决死循环问题。

**回复断言固化修复：**

- `bank.ts` 的 `UpdateTaskBody` / `updateTask`（WRITE 路径）增加 `contains` / `not_contains` 持久化；`ItemSide` / `TaskDetail` / `sideFrom` / `getTask`（READ 路径）返回 `contains` / `not_contains`。
- 前端 `bank.js` + `index.html` 编辑表单补全回复断言字段。
- 回归测试 C-B-35 覆盖 WRITE + READ 两端。
- 验证通过：`typecheck` 0 错误，`vitest` 全量 44 文件 214 测试通过。

**中文回复指令固化：**

- `AGENTS.md` 第 3 行与 `.cursor/rules/dev-process-skills.mdc` 第 16 行新增「始终用简体中文回复」指令，统一思考、对话、代码注释、报告使用简体中文。

**T6 ON 重跑事实记录（2026-09-22）：**

- 重跑 run ID：`20260922-205152392-66in`（ON，paired-on-effect-smoke，题目 157/158/159）
- 死循环未复现：三题均 `timed_out=false`、无强停信号、4–14 秒内自行退出，确认此前死循环已修复
- ON 仍 0/3：三题全部 `host_exit=1`、`workspace_ran=true`、`workspace_ok=false`（模型未完成要求的代码修改，如 discount/tax 未含 Math.round、端口未对齐 8443、query 无 split）
- 共同信号：`event_store_present=false`、`event_store_reason=no-store-ref`；线索指向万象术 0.8+ 耐久改为 `refs/wanxiang/store`，旧 EventStore 协议探针（读 `.wanxiangshu.ndjson` 挂载）可能未适配
- 对照未跑：因 `host_exit=1` 触发停止条件
- 待定：方向 A（适配 EventStore 协议探针后重跑做有效对照）vs 方向 B（接受两轮 ON 0/3，维持「插件未改善」结论）

### T6 最终有效对照（2026-09-22）

**最终有效 ON run：**

- Run ID：`20260922-213356265-krzh`。
- 三题全部 `host_exit=0`、`timed_out=false`、`event_store_present=true`（8 种事件：Agent/ChatExecution/Companion/Context/Host/JournalEnvelope/Prompt/Runtime/RuntimeStarted）、`materials_mutated=true`、`pass_token_present=true`。
- 但 `workspace_ok=false`，每道题差最后一个 oracle，均为 MODEL_TASK 失败：157 缺 `lib/discount.mjs` 的 `Math.round`；158 缺 `docs/runbook.md` 的 `8443`；159 缺 `lib/validate.js` 的 `^[A-Za-z]` 正则。

**插件全链路打通：**

- 死循环、准入拒绝、配置校验拒绝三个闸门全部解决。
- 根因链：openCode 的 `fast-`/`deep-` 前缀 agent 名触发 InvalidExplicitAgent（chat admission 不认识）→ 去前缀后 `coder/inspector/browser/inquiry/distiller` 仍是 legacy 名，触发 managed-agent-config-invalid（config 校验拒绝）→ 最终收窄为 7 个非 legacy 名（manager/orchestrator/engineer/devops/blogger/bookkeeper/predictor），主 agent 为 engineer。

**对照结论：**

- baseline（OFF）`20260922-162303606-yxmz`：pass_rate 1.000（3/3）。
- candidate（ON）`20260922-213356265-krzh`：pass_rate 0.000（0/3）。
- Δ = −1.000；无 CONTEXT 事件，排除后不变。

**结论：**

- 万象术插件未改善模型效果，本配对中严格更差（OFF 全过、ON 全挂）。——**该结论对照基准无效（ON 编排从未启动，OFF/ON 并非有效配对），已被 §8 根因纠正架空。**
- DoD 本意「OFF 必挂、ON 有机会过」，实测方向相反——**原记录归因为「题面 157–159 需回到改题工作」，该结论已于 2026-09-22 被证伪（见下方 §8 根因纠正）。**

---

## 8. 根因纠正：T6 ON 编排未启动（2026-09-22）

**原结论已证伪：** §7 末记录「题面 157–159 需回到改题工作」在题面层面过早归因，遗漏了真实根因。

**真实根因：** `examples/product-eval/rooms/hosted-plugin-v1.json` 的 `host.agent` 字段被误设为 `"engineer"`——叶子执行者角色，无 bash、无编排权限。opencode 以 Engineer 身份直接启动根会话，**整个 Orchestrator → Manager → Engineer + DevOps 编排链从未启动**。Engineer 在既无 bash 又无 DevOps 执行者的情况下盲改代码，改完即发通关暗号，从未运行测试。三题各缺一个文件正是盲改模式的典型特征，与题面设计无关。

**EventStore 证据（DevOps 检查确认）：**
- ON 运行中仅存在 `engineer`、`blogger` 两个会话
- `devops`、`manager`、`orchestrator` 从未出现
- 完整编排链缺失——ON 侧实际测得的是「无编排的 Engineer 盲改」而非「插件辅助的 Agent 协作」

**已修复：**
- `hosted-plugin-v1.json` 第 20 行 `"agent": "engineer"` → `"agent": "orchestrator"`
- 修复后 Orchestrator 作为根会话启动，方可拉起 Manager → Engineer + DevOps 完整编排链

**待办：** 修复后需重跑 T6 的 ON 侧实验，验证编排是否真正拉起（EventStore 出现 orchestrator/manager/devops 会话 + workspace_ok 通过）。题面 157–159 本身无需改动，待新运行证据更新效果结论。
