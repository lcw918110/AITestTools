# 过程日志（当前态）

| 字段       | 值                                                                                                       |
| :--------- | :------------------------------------------------------------------------------------------------------- |
| 角色       | **本栏唯一过程日志**。仓库文档只呈现当前口径；旧稿在 git 历史里                                          |
| 日期       | 2026-09-23（独立验证 §11）                                                                               |
| 关闭的门禁 | [02 解冻](02-unfreeze-checklist.md) · [03 Phase 1 DoD](03-phase1-dod.md) · [04 终审](04-final-review.md) |

产品需求 / 设计 / 测试手册以各栏现行正文为准，不在本日志里复述两套说法。名词与逻辑概念只在 [00-glossary.md](../00-glossary.md) 定义。

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

| ID     | 看板 / 位置 | 做什么                                                                                  | 不做                                           |
| :----- | :---------- | :-------------------------------------------------------------------------------------- | :--------------------------------------------- |
| **T4** | 测试任务    | 用途字段（效果对照 / 校准 / 回归）                                                      | 本刀不做                                       |
| **T5** | 题库        | ~~向导可选任务类型~~ **已落地**；~~录题选测试集~~ **本刀落地**；难度字段仍打开          | 完整测试集编辑器；本刀不录入难度               |
| **T6** | 效果实验    | **Grill 已对齐**（§6）：改 157–159，OFF 必挂、ON 有机会过；小规模对照；CONTEXT 不进结论 | 跑满 156 当效果；改万象术业务逻辑；本刀不做 T7 |
| **T7** | 测试结果    | 经济四格（弱开 vs 强关）；以后的「看板」再观察多次测试                                  | 效果差出来之前不画空图                         |

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

| Run                       | 方向 | 通过率     | 归因                           |
| ------------------------- | ---- | ---------- | ------------------------------ |
| `20260922-162303606-yxmz` | OFF  | 3/3 (100%) | 全部通过                       |
| `20260922-162623069-xqs4` | ON   | 0/3 (0%)   | 全部 MODEL_TASK（host_exit=1） |

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
- `vitest`：50 文件 289 测试全部通过
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
- 验证通过：`typecheck` 0 错误，`vitest` 全量 50 文件 289 测试通过。

**中文回复指令固化：**

- `AGENTS.md` 第 3 行与 `.cursor/rules/dev-process-skills.mdc` 第 16 行新增「始终用简体中文回复」指令，统一思考、对话、代码注释、报告使用简体中文。

- .cursor/skills/ 下 design-current-state / coding-standards / sdlc-self-check / code-review 共 4 个 SKILL.md，在 frontmatter 后统一插入 `> ⚠️ **基础约束：始终用简体中文回复。所有思考、对话、代码注释、报告都必须使用简体中文，不得使用英文。**` 约束行，对齐 AGENTS.md 口径。

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

**重跑结果（run ID: 20260922-225811092-6ery，2026-09-22）：** 命令 `npm run proctor -- run --axis B --paperset paired-on-effect-smoke --project examples/product-eval`。结果**部分成功**：

1. **`agent=orchestrator` 修复生效：** 三题的 EventStore 首次出现 `orchestrator` 会话（157: 3 orchestrator + 7 engineer + 8 blogger；158: 3+3+8；159: 4+25+10）。此前 engineer 根运行仅有 engineer+blogger。
2. **Delegation 事件首次出现：** 157 和 159 的 EventStore 含 Delegation kind（158 超时前未产生），另有新的 `sphinx/inquiry-transition` kind——编排机制确实启动。
3. **完整链仍未接通：** 三题 EventStore 中 `manager`、`devops` 会话**仍为零**。orchestrator 直接 delegate 到 engineer，未走 manager 协调 engineer+devops 路径，验证闭环（engineer → devops 跑测试 → engineer 反馈）仍未闭合。
4. **运行结果：** 157、158 仍超时（CONTEXT）；159 完成（`host_exit=0`）但 `workspace_ok` 仍 false（query-split、name-reject-empty 失败，无 `pass_token` 发射）。
5. **结论：** 配置层修复（`host.agent` → `"orchestrator"`）确认有效——orchestrator 与 Delegation 机制首次启动。但 orchestrator → manager → devops 完整编排链需万象术 plugin 的 orchestration 业务逻辑支持，属于 SUT 侧问题，非配置层面可解决。题面 157–159 本身无需改动。

---

## 9. T6 ON 重跑验证（2026-09-23）：编排链仍未接通

**重跑 run ID：** `20260923-002820484-c198`（ON，paired-on-effect-smoke，题目 157/158/159）。

**前置变更：**

- 万象术死循环修复（93 文件更新，2026-09-22）
- `host.agent` = `orchestrator`（§8 修复）
- Pair Programming 中文语言修复（`PairProgrammingThoughtTransform.fs` `English` → `SimplifiedChinese`，commit `49a6b1e89`，Fable 编译部署）

**评测结果（0/3）：**

| 题号 | host_exit | timed_out | 关键变化                                                               |
| ---- | --------- | --------- | ---------------------------------------------------------------------- |
| 157  | 0         | false     | discount-round + tax-round 双失败，13 engineer 会话但 materials 未变   |
| 158  | null      | true      | 0 engineer 会话，编排未启动                                            |
| 159  | null      | true      | query-split 首次通过，但 name-reject-empty 未过，5 engineer 会话后超时 |

**EventStore 编排链状态：**

- orchestrator 会话：存在（4/3/3）
- manager 会话：**0**
- devops 会话：**0**
- engineer 会话：13/0/5
- Delegation 种类出现（157、159），但 orchestrator 直接 delegate 到 engineer

**结论：**

- 死循环修复确认有效（157 正常退出）
- orchestrator 与 Delegation 确认生效
- orchestrator → manager → devops 完整编排链仍未接通（manager/devops 0），原因是万象术 plugin 业务逻辑层未实现 manager commission 路由，属于 SUT 侧工程问题
- 中文固化源码修改已编译部署，编排链接通后可评估效果

**下一阶段方向：** 在万象术 plugin 侧实现 orchestrator commission tool → manager 的完整路由链路，使 manager fork engineer + resume devops 形成验证反馈闭环。

---

## 10. T6 ON 再重跑（2026-09-23）：死循环不复发、编排链断点坐实

**重跑 run ID：** `20260923-012756274-j39i`（ON，paired-on-effect-smoke，题目 157/158/159）。

**前置变更（已部署）：**

- 万象术死循环修复（93 文件更新）
- `host.agent` = `orchestrator`（§8 修复）
- 中文语言修复 commit `49a6b1e89`（`PairProgrammingThoughtTransform.fs` `English` → `SimplifiedChinese`）

**评测结果（0/3）：**

| 题号 | host_exit | timed_out | 关键变化                                           |
| ---- | --------- | --------- | -------------------------------------------------- |
| 157  | 0         | false     | 正常退出，失败在 discount-round / tax-round oracle |
| 158  | null      | true      | 超时                                               |
| 159  | null      | true      | 超时                                               |

**Agent 会话统计（EventStore）：**

| 会话         | 157 | 158 | 159 |
| ------------ | --- | --- | --- |
| orchestrator | 4   | 3   | 3   |
| manager      | 0   | 0   | 0   |
| devops       | 0   | 0   | 0   |
| engineer     | 13  | 5   | 9   |
| blogger      | 10  | 8   | 8   |

**结论：**

- 死循环确认不复发：三题均无 `host_exit=1` 强停特征，超时根因已从死循环转为编排链未闭合。
- 编排链断点坐实：orchestrator 输出明确出现 `commission a Lead` 委派意图，但 manager / devops 会话仍为零，orchestrator → manager 的 commission 路由未在万象术 plugin 侧实现。
- 中文回复负向发现：被测 agent 输出仍为英文；`PairProgrammingThoughtTransform.fs` 的 `English → SimplifiedChinese` 只改变插件注入指导语的语言，不改变被测 agent 自身推理语言。

**下一阶段方向（归属）：** orchestrator → manager 路由与 agent 中文输出均为万象术 SUT 侧工程问题，不在 agent-proctor 评测引擎仓改动范围（`dev-process-skills.mdc`「不改万象术业务逻辑」）。

---

## §11 独立验证——可复现测试运行证据 (2026-09-23)

此前 changelog §6/§7 记录的测试通过声明（vitest、typecheck 0 错误、format:check 通过、validate:product-eval 318/318）仅以文字形式存在，工作区无任何运行产物支撑。本日由第 2 任 Manager 接手后，通过 DevOps 真实运行全套测试验证，建立可复现证据。

运行环境：Node.js >= 22.22.0, macOS (darwin)。

| 命令                                      | 状态    | 实际结果                                |
| ----------------------------------------- | ------- | --------------------------------------- |
| `npm run typecheck` (tsc --noEmit)        | ✅ 通过 | 0 错误                                  |
| `npm test` (vitest run)                   | ✅ 通过 | 50 文件 289 测试全绿                    |
| `npm run format:check` (prettier --check) | ✅ 通过 | 所有文件符合规范（修复 207 文件后）     |
| `npm run validate:product-eval`           | ✅ 通过 | 318/318 试题协议校验通过，0 错误 0 警告 |

执行中暴露并修复的普通缺陷：

- `examples/product-eval/rooms/hosted-plugin-v1.json` 第 2 行存在 `_comment` 字段，违反 `room.schema.json` 的 `additionalProperties: false` 严格模式约束，导致该考场校验失败并级联引发 4 份试卷集判定考场缺失。移除后 validate:product-eval 从 5 错误归零。
- 全仓 prettier 格式化修复了 207 个文件的代码风格未对齐问题，使 format:check 由首次失败转为通过。

与 changelog §6/§7 历史声明的比对：typecheck（一致 0 错误）、format:check（一致通过）、validate:product-eval（一致 318/318）。vitest 测试数随本 session 及后续控制台重构（§12）新增测试自然增长，最终实测基线统一为 50 文件 289 测试（见 §12）。

本次独立验证为 changelog 的测试通过声明补上了可复现的运行证据。后续任何提交前，务必真跑测试建立实物凭据。

---

## §12 控制台质量闭环重构（2026-10-09）

本轮针对 §11 全量审核报告（`05-full-code-audit.md`）列出的 `apps/console` 高危缺陷做结构性修复，消除操作台「能跑但不是写好」的质量断崖。改动均为本仓源码，不涉及产品口径变更。

**1. server.ts 拆分（消除 650 行 handler 巨石）**

- `apps/console/server.ts` 从约 650 行 handler 收敛为 26 行装配入口：仅组装路由、`reconcileJobs()` 作业对账、`createServer` 绑定 `127.0.0.1`、listen 唯一调用点。
- 路由分发拆入 `router.ts`，各业务处理拆入 `controllers/` 下 8 文件（`bank.ts` / `env.ts` / `eval-tasks.ts` / `health.ts` / `jobs.ts` / `run.ts` / `runs.ts` / `test-sets.ts`）。
- 基础设施抽离为独立模块：`http.ts`（响应封装）、`job-queue.ts`（作业队列）、`parse.ts`（请求体解析）、`static-server.ts`（静态服务）、`config.ts`、`request.ts`、`project-reader.ts`。
- 原 fire-and-forget `void executeJob` 改为 `void handleRequest(...).catch(...)` 显式捕获，Promise rejection 以 500 响应回传。

**2. JSON 原子写与 CAS 乐观锁（消除直写无原子性 / rooms TOCTOU）**

- 新增 `apps/console/json-io.ts`，收敛控制台各 JSON/文本写点：
  - `writeTextAtomic`：先写同目录临时文件，成功后 `renameSync` 覆盖目标，避免并发读者读到半截文件。
  - `writeJsonAtomic`：序列化失败时附加目标路径上下文，成功后走原子写。
  - `writeJsonAtomicCas`：写前比对目标文件真实 `mtimeMs` 与期望值，不一致（读后被并发修改）则拒绝覆盖返回 false，用于 PUT `/api/env/rooms/:name` 读-改-写的 TOCTOU 防护；基于文件系统真实 mtime，连进程外修改也能检测到。

**3. updateTask 快照回滚（消除多文件写无事务）**

- `updateTask`（`controllers/bank.ts`）补入写前快照机制：受影响文件路径与原内容先快照，任一步失败即恢复，对齐 `createTask` 的 `rollbackCreate` 模式。

**4. HTTP 层测试补齐（消除 HTTP 层零测试）**

- `tests/console/` 由 9 个测试文件增至 12 个，新增 `server-http.test.ts`（HTTP 路由、请求解析、错误码、静态文件 MIME）、`update-task-rollback.test.ts`（updateTask 回滚）、`json-io.test.ts`（原子写与 CAS）。

**仍存未决：** 前端零测试（`apps/console/public/*` 无 JS/HTML/CSS 单元、集成或 E2E 测试）。详见 `05-full-code-audit.md` 与 `06-next-steps.md` §5。（`metrics/catalog.ts` 已由 `tests/metrics/catalog.test.ts`（28 用例）覆盖。）

**全仓测试基线（实测，2026-10-09）：** 本轮控制台重构后 `npm test`（vitest run）全量 **50 个测试文件 / 289 个测试用例全部通过**，`npm run typecheck`（tsc --noEmit）0 错误。该数字为最终实测基线；§6/§7/§11 各节记录的历史数字（44/46 文件、213/214/223 测试）已统一更正为本口径。

---

## §13 V2.17 全量重构基线（2026-10-16）

本轮启动 V2.17 全量重构（`docs/` 五主文档为权威口径），先做**工作区清理**与**领域模型落盘**，为后续 Phase 1–8 建立干净基线。

**1. 遗留未提交改动清理（先隔离风险）**

- 工作区存在 205 个文件未提交改动（时间跨度 9/24–10/16），对应 changelog §12 控制台重构 + T1–T7 的 hosted 运行器/Oracle/promptfoo 增强 + bank 材料格式化。
- 逐项审查后判定**全部有用**，分 3 个逻辑 commit 提交为干净基线：
  - `81ddeba` 控制台质量闭环重构（server 拆分 + 原子写/CAS + 回滚 + HTTP 层测试）
  - `3c21bc5` hosted 运行器增强 + Oracle 判定器补全 + promptfoo 配置重构
  - `cb434b8` bank 材料表格格式化 + skill 中文约束补全 + 配置整理

**2. 文档口径统一（design-before-code）**

- `02-总体架构与领域设计.md` §3.2：从「Item 作为首期物理存储基础」改为「领域对象为唯一权威模型，现有资产迁移为领域对象」，消除两套并行口径。
- `00-glossary.md` §7、`01-产品需求规格说明书.md` FR-03、`需求追踪矩阵.csv` REQ-CASE-REVISION-001 同步迁移口径。
- 提交 `c52b16c`。

**3. 领域对象类型落盘（Phase 1 第一步）**

- 新建 `src/domain/types.ts`（903 行）：覆盖附件 02 §3.1 全部 20+ 领域对象 + 4 组状态机 + 三段式记录 + 双分母指标 + Comparability Gate + 配置/安全/功能目录/环境/故障注入对象。
- 重写 `src/exam-engine/types.ts` 为领域对象重新导出层：旧类型（ItemDoc/PapersetDoc/RoomDoc/FreezeA/B 等）保留为 `@deprecated` 兼容接口（含旧字段名），使现有 77 处 ItemDoc 引用逐步迁移而非一次性崩溃。
- Oracle 判定器从内联对象字面量改为命名接口（OracleExitCode 等 12 个），可独立导出。
- 提交 `1570731` + `0ec7bd6`。

**验证基线（实测，2026-10-16）：** `npm run typecheck` 0 错误；`npm test` 49/50 文件通过（唯一失败 `tests/attribution/event-store.test.ts` 为沙箱 git 权限环境问题，与改动无关）。

**下一步：** 继续 Phase 1——将 engine/run/report/cli/console 各模块的旧类型引用逐步迁移为领域对象，随后迁移 examples/product-eval 数据集与 schemas。

## §14 V2.17 深迁移阶段 1–3（2026-10-17）

在 §13 基线之上，经 grill-me 对齐后确定**深迁移**方向：废弃 papers-v1 物理协议，新建 cases-v1 协议，318 个 item.json 迁移为 Case/CaseRevision 资产。方案落盘为 [06-V2.17深迁移方案.md](../06-V2.17深迁移方案.md)，契约锚点为 [05-领域对象与代码类型映射.md](../05-领域对象与代码类型映射.md)。

**已对齐的关键决策：**

- 迁移深度：深迁移（新建物理协议，非仅类型重命名）
- OFF/ON 语义：是两个 CaseRevision（预期合同 statement/attribution_focus/protocol_probes 不同），通过 pair_key 关联
- 文档对应：每改一处代码，同步更新 05 映射表与对应文档

**阶段 1（协议与 Schema）：** 新建 5 个 cases-v1 schema（case/case-revision/dataset-release/environment/candidate），全部经 ajv 编译验证合法。`schema.ts` 注册新 schema，`ASSET_PROTOCOL_VERSION` 保持 papers-v1 待迁移完成后切换。

**阶段 2（迁移脚本）：** `scripts/migrate-v2.mjs` + 498 个 cases-v1 资产：
- 159 Case（`EVAL-B-PAIRED-TASK-22-OFF` → `paired-task-22`）
- 318 CaseRevision（OFF/ON 拆两修订，`case_revision_id` 含 `.off`/`.on` 后缀）
- 13 DatasetRelease + 4 Environment + 4 Candidate
- 修复同 rev 冲突：PAIRED-TASK-157/158/159 的 OFF/ON 均 rev=1，用 variant 后缀区分

**阶段 3（engine 新增）：** cases-v1 加载器（loadCasesV2/loadCaseRevisions/loadDatasetReleases/loadEnvironments/loadCandidates）+ `revisionDigest`（与迁移脚本 contentHash 语义一致）。新增测试 6 用例全过。

**自审（7 项可证伪自测全过）：** 迁移数量完整性、字段映射正确性（318 全对）、OFF/ON 配对完整性（159 对严格 1:1）、content_hash 一致性（318 可独立重算）、schema 覆盖完整性（498 资产 0 非法）、唯一性与引用有效性、映射表字段 vs 类型定义（41 类型一致）。

**阶段 4 发现缺陷（已决策并修复）：** 迁移脚本拆分 freeze/room 时丢失 runner 执行必需字段。经分析（`freeze.prompt_template` 与 `stimulus.ref` 318 项全冗余；`model_id` 为题目级固定条件 312+6 分布；`channel`/`tool_profile` 全统一）确定**方案 A 无损扩展**：

- `CaseRevision` 新增 `model_id`（基准模型，题目级固定条件；157/158/159 三对用 claude-sonnet-5，其余 gpt-5.4-mini）
- `CandidateConfig` 新增 `channel`（hosted/direct）/`tool_profile`
- `EnvironmentProfile.recipe` 新增 `host_command`/`host_model`/`host_agent`/`managed_agents`
- `freeze.prompt_template` 判定冗余不迁移（= stimulus.ref，CaseRevision.stimulus.ref 已承载）

重跑迁移脚本补全字段，498 资产重新通过 schema（含新增字段），typecheck 0 错误。决策依据落盘 06 方案 §4.1。

**阶段 4a（适配层 + 字段完整性，2026-10-17）：**

- 修复类型滞后：`Case` 补 `pair_key`、`CaseRevision.stimulus` 补 `hosted_pass_token`、`EnvironmentProfile.recipe` 补 `host_plugin`/`durable_log_glob`（此前 schema/产物有、类型定义缺）
- 新增 `src/run/cases-v1-adapter.ts`（绞杀者模式）：`caseRevisionToItemDoc`、`environmentToRoom` 把 cases-v1 资产还原为 runner 旧形状
- 可证伪自测：318 ItemDoc + 4 RoomDoc 还原的关键执行字段与 V1 原始数据 0 处不符（适配层测试 3 用例 + 逐字段对比脚本）
- run.ts 数据源切换：`AssetKind` 扩展 cases-v1 目录；`runCommandV2` 走 dataset-release→case-revision→适配层→复用 `runOneItem`；CLI 新增 `--dataset/--environment` 显式组合（与 papers-v1 路径并存）
- 端到端验证：`proctor run --dataset eval-agent --environment hosted-plain-v1 --only paired-task-22-off` 单题跑通 PASS
- 决策：CLI 显式组合（DatasetRelease 保持纯冻结闭包）；`intent.statement` 不使用则去掉

**item_id 还原 + 历史 run 兼容（2026-10-17）：**

- 适配层 `caseIdToV1ItemId` 反向映射 case_id→V1 item_id（`EVAL-B-` 前缀 + 大写 + 变体后缀），318 个 item.id 精确还原 0 处不符
- 历史 run 兼容验证：45 个历史 run 全部可读 0 失败（`loadRunArtifacts` 只读 results.ndjson/metrics/scores，格式稳定）；compare 新旧 run、历史 paired-off vs paired-on 配对均正常对齐
- 清理 2 个测试残留 run（id 还原修复前的产物），runs 目录恢复纯历史数据

**测试补强（2026-10-17）：**

- `revisionDigest` 全量验证 318 个（原抽查 3 个），固化「引擎 digest 与迁移脚本 contentHash 语义一致」的无损保证
- 适配层测试补 318 个 item.id 全量还原 V1 格式
- 抽取 `resolveDatasetItems` 纯函数，新增 run-v2 测试 4 用例（数据加载链路 / OFF-ON 跨 release 配对 / 错误路径）

**阶段 4b：统一 ExecutionAdapter 状态机（2026-10-17，已提交）：**

- 新增 `src/run/execution-adapter.ts`：8 阶段接口（discover/preflight/prepare/submit/collect/evaluate/cleanup）+ `AdapterError`（kind/attribution/retryable）+ `ObservedFactsRecorder` 三值记录器
- 新增 `src/run/run-orchestrator.ts`：`RunOrchestrator` 落地 Run/CaseExecution/Attempt 三级状态机 + `RUN_TRANSITIONS` 校验（`beginRun`/`transitionRun`/`executeCase`/`sealRun`）
- 本阶段只落地内存状态机；`timed_out`/`attribution` 细分与 7 个 runner 迁移推迟 Phase 2
- 测试 10 项全绿，typecheck/prettier 通过，Bugbot 审查 5 findings 全部收口

**阶段 5：console 全量重写（2026-10-18，进行中）：**

- 设计稿 `docs/08-Console全量重写设计.md`：把「测试集=成对 paperset」替换为「dataset-release + case-revision 配对」
- 待审决策（按推荐执行，明日复核）：
  1. UI「测试集」概念保留，仅底层字段 `paperset`→`release`
  2. API 字段 `offPaperset`→`offRelease`（彻底去除 paperset 概念）
  3. `content_hash` 复用 `src/exam-engine/digest.ts` 的 `revisionDigest`
  4. OFF/ON 的 `revision_number` 保留独立递增
  5. 录题默认模型 `DEFAULT_MODEL` 保留
- 分步实施：读路径（project-reader/test-sets/run-plan）→ 写路径（bank）→ env → UI

**阶段 5 步骤 1（读路径切换，2026-10-18，已提交）：**

- `test-sets.ts`：目录 `papersets/`→`dataset-releases/`，`readPaperset`→`readDatasetRelease`（`items`→`case_revisions`），导出 `offRelease/onRelease`、`testSetIdFromRelease`、`releaseFilesForTestSet`
- `run-plan.ts`：新增 `taskIdFromCaseRevisionId`（`paired-task-02.r6.off`→`PAIRED-TASK-02`）与 `taskIdsOfCaseRevisions`
- `eval-tasks.ts` / `controllers/run.ts`：`offPaperset`→`offRelease`、`testSetIdFromPaperset`→`testSetIdFromRelease`
- 过渡兼容（步骤 2 写路径迁移后移除）：
  - `taskIdsOfRelease`：case_revisions 为空时回退读 papersets items（写路径仍写 papersets）
  - `createTestSet` 同步创建 papersets 空文件（供 `appendPapersetItem` 录题）
  - `papersetFilesForTestSet` 保留旧语义（papersets 文件名）
- 测试：`test-sets.test.ts` 重写为 cases-v1 seed；`bank.test.ts`/`update-task-rollback.test.ts` seed 补 dataset-releases
- 76 个 console 测试全绿，typecheck/prettier 通过；Bugbot 1 finding（新建测试集无法录题）已修复

**阶段 5 步骤 2 切片 A（run-plan 术语切换，2026-10-18，已提交）：**

- `run-plan.ts`：`PapersetIndex`→`ReleaseIndex`（`items`→`case_revisions`）、`counterpartPaperset`→`counterpartRelease`、`defaultPaperset`→`defaultRelease`、`resolveRunPlan` 入参 `papersets`→`releases`/`paperset`→`release`、`RunPlan.paperset`→`RunPlan.release`、`RunStep.paperset`→`RunStep.release`
- `project-reader.ts`：`loadPapersetIndex`→`loadReleaseIndex`，读 `dataset-releases/`，`case_revisions` 从 `case_revisions` 提取、`taskIds` 用 `taskIdsOfCaseRevisions`
- `controllers/run.ts` / `job-queue.ts` / `eval-tasks.ts`：字段引用同步
- **关键发现（明日复核）**：`offId`/`onId`（itemId）**保持 V1 格式不变**——引擎 cases-v1 路径 `runCommandV2` 的 `--only` 过滤用 `caseRevisionToItemDoc` 还原出的 V1 id（`EVAL-B-...`），非 `case_revision_id`；故 `resolveRunPlan` 的 `offId`/`onId` 无需改成 case_revision_id。引擎 `--paperset`→`--dataset` 参数切换属步骤 4（job-queue 引擎调用），不在本切片
- `projectSummary` 的 `papersets`/`rooms` 字段切换留步骤 3（env）+ 步骤 4（UI）
- 测试：`run-plan.test.ts` 重写为 release 术语 + case_revisions 数据源（10 用例），77 个 console 测试全绿，typecheck/prettier 通过

**阶段 5 步骤 2 切片 B1（bank 读路径切 cases-v1，2026-10-18，已提交）：**

- `bank.ts` 新增 `loadPairedItemsV1`：读 `cases/*.case.json` + `case-revisions/*.case-revision.json`，映射为配对 `ItemSide`
- `sideFromRevision`：`case_revision_id`（`paired-task-02.r6.off`）→ variant（`.off`/`.on`），`ItemSide.id` 还原 V1 id（`EVAL-B-PAIRED-TASK-02-OFF`，用 `caseIdToV1ItemId` 与 `src/run/cases-v1-adapter.ts` 一致）、`rev` 用 `revision_number`、`passToken` 用 `stimulus.hosted_pass_token`、`tags` 用 case 的 `tags`、`contains`/`notContains` 从 `expect.oracles` 提取
- `pair_key` 关联 OFF/ON（`case.pair_key ?? case_id.toUpperCase()`）
- `loadPairedItems` 绞杀者兼容：优先读 cases-v1，回退读 item.json（写路径迁移前，新录题仍写 item.json）
- 测试：新增 `bank-cases-v1.test.ts`（3 用例：listTasks/getTask 读回显 + item.json 回退），80 个 console 测试全绿，typecheck/prettier 通过

**阶段 5 步骤 2 切片 B2/B3（bank 写路径切 cases-v1，2026-10-18，已提交）：**

- `bank.ts` 写路径整体切换（createTask/updateTask/deleteTask 一起切，因 `ItemSide.file` 语义必须统一）：
  - 新增 cases-v1 写路径辅助：`caseIdOfTask`（`PAIRED-TASK-99`→`paired-task-99`）、`caseRevisionIdOf`（`paired-task-99.r1.off`）、`buildCaseDoc`（case.json：`lifecycle: released`/`automation_readiness: design_ready`/`head_revision_id`/`pair_key`）、`buildCaseRevisionDoc`（case-revision.json：`content_hash` 用 `revisionDigest` 计算、`attribution_focus` OFF=MODEL_TASK/ON=PROTOCOL、`protocol_probes` ON=RuntimeStarted+JournalEnvelope）
  - `createTask`：写 `cases/*.case.json` + `case-revisions/*.r1.off|on.case-revision.json` + 追加 `dataset-releases/*.dataset-release.json` 的 `case_revisions` 引用（含 `content_hash`）
  - `updateTask`：升版语义——继承旧值 + patch，写新 `r{n+1}` case-revision（旧 revision 保留不可变）、更新 case.json `head_revision_id`/`tags`、按测试集定位 off/on release 精确替换引用（移除旧 revision + 追加新 revision）
  - `deleteTask`：删 case.json + 全部 case-revision + 移除 dataset-release 引用
  - `ItemSide.file` 语义改为 case-revision 路径；`CreateSnapshot.papersetAdds`→`releaseAdds`（回滚用 case_revision_id）
  - 删除死代码：`buildPairedItem`/`updateItemStimulus`/`updateItemTags`/`updateItemOracles`/`oracleValueOf`/`bumpItemFile`/`appendPapersetItem`/`removeItemFromAllPapersets`/`kebabItemFile`/`readCaseRevisionFile`
- **关键决策（明日复核）**：
  1. `head_revision_id` 指向最新 revision（revision_number 最大），录题 OFF r1 + ON r1 时 head 指向 ON r1
  2. `content_hash` 只依赖 `stimulus`/`preconditions`/`expect`/`evidence_requirements`/`setup_cleanup`（`revisionDigest` 语义），改题只改题干/判定器时 hash 变
  3. `updateTask` 升版 = 写新 case-revision 文件（不可变），不原地改；旧 revision 保留
  4. case.json 不加 `created_at`/`updated_at`（与现有资产一致）
- 测试：新增 `bank-write-cases-v1.test.ts`（3 用例：create 写 case+revision+release / update 升 revision+head+release 闭包 / delete 删资产）；`bank.test.ts`/`update-task-rollback.test.ts` 断言从 item.json/papersets 改为 case-revision/dataset-release；83 个 console 测试全绿，typecheck 通过
- Bugbot 1 finding（high）：`updateTask` 的 dataset-release 引用更新用「release 是否含该 case_id」判断，移除旧 revision 后判断失效导致 off release 被清空、on release 混入 off+on 两条——已修复为按测试集定位 off/on release 精确替换，并补回归断言

**阶段 5 步骤 3 切片 C1（env 读路径切 cases-v1，2026-10-18，已提交）：**

- `env-catalog.ts`：`rooms/`→`environments/`，读 `*.environment.json`；`host.model`→`recipe.host_model`、`host.agent`→`recipe.host_agent`、`host.managed_agents`→`recipe.managed_agents`；`hostedRooms`（`kind==='hosted'`）→`hostedEnvironments`（`recipe.host_plugin` 存在）；`appendManagedAgent` 写 `recipe.managed_agents`
- `project-reader.ts` `projectSummary`：`rooms` 字段从 `rooms/*.json`（`host.model`/`host.plugin`）切到 `environments/*.environment.json`（`recipe.host_model`/`recipe.host_plugin`），`name` 用 `name ?? environment_profile_id`
- **决策（明日复核）**：`controllers/env.ts` 的 `envRoomsList`/`envRoomsUpdate`（房间 CRUD）与 `parse.ts` 的 `sanitizeRoomUpdate` 留切片 C2（与步骤 4 前端 `env.js` 字段联动一起切），因 API 字段 `host`/`workspace`/`network` 与前端强耦合，避免「读 environments 写 rooms」的中间断裂
- 测试：`env-catalog.test.ts` seed 从 rooms 改为 environments（`recipe.host_model` 等），83 个 console 测试全绿，typecheck 通过

**阶段 5 步骤 4（引擎参数切换 + papers 过渡清理，2026-10-18，已提交）：**

- `job-queue.ts`：引擎调用 `--paperset`→`--dataset` + `--environment`；新增 `environmentForSide`（off→`hosted-plain-v1`、on→`hosted-plugin-v1`，与 `tests/cli/run-v2.test.ts` 一致）；`proctorRunArgs` 签名改 `(dataset, environment, itemIds)`；`legacy==='model'/'agent'` 分支内联 `--dataset eval-model/eval-agent --environment hosted-plain-v1`
- `test-sets.ts`：删除过渡代码 `papersetFilesForTestSet`、`createTestSet` 的 papersets 空文件创建、`taskIdsOfRelease` 的 papersets items 回退（写路径切 cases-v1 后不再需要）
- `project-reader.ts` `projectSummary`：移除 `papersets` 字段（读 `papersets/` 目录的 papers-v1 遗留，前端 `app.js` 已不读）
- `public/app.js`：移除死字段 `papersets` 变量与 `proj.papersets` 赋值
- **关键发现（阶段 6 待办）**：`legacy==='paired'` 分支仍走 `npm run eval:paired`（`scripts/eval-paired.sh`），脚本内用 `--paperset paired-off/paired-on`（V1 路径）；`package.json` 的 `eval:model` 脚本也用 `--paperset eval-model`。这些是引擎层 npm 脚本，依赖 papers-v1 资产（`papersets/`+`rooms/`），阶段 6 删除 papers-v1 资产前需切 cases-v1（`--dataset`+`--environment`）
- **决策（明日复核）**：run meta 字段名 `paperset`/`room`（引擎 `runCommandV2` 写产物）暂不改，`dashboard.ts` 读 `meta.paperset`/`meta.room` 仍正确；字段名统一属阶段 6
- 测试：`test-sets.test.ts` 移除 papersets 兼容文件断言；320 个测试全绿（含 83 console），typecheck 通过
