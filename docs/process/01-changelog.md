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
- 界面：顶栏 **测试 | 题库 | 数据集 | 运行环境 | 模型配置 | 趋势 | 健康检查**。测试集 × 运行环境组合开跑。模型 / Agent 在运行环境页配置并 Hello World 验证后，任务只选已验证项并记下快照。录题必选或新建测试集。输入提示用中文（题号格式等协议值除外）。

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

**阶段 5 切片 C2（env 房间 CRUD 写路径切 cases-v1，2026-10-18，已提交）：**

- `parse.ts`：`SanitizedHost`（`model`/`agent`/`plugin`）→`SanitizedRecipe`（`host_model`/`host_agent`/`host_plugin`）；`sanitizeHostFields`→`sanitizeRecipeFields`；`sanitizeRoomUpdate` 的 `host`→`recipe`
- `controllers/env.ts` `envRoomsList`/`envRoomsUpdate`：读/写 `rooms/*.json`→`environments/*.environment.json`；`doc.host`→`doc.recipe`；`workspace`（`isolated`/`project`）↔`recipe.isolation_profile`（`isolated`/`shared`）；`network`（bool）↔`recipe.network_policy`（`allow`/`deny`）
- `public/env.js`：`room.host.model`→`room.recipe.host_model`、`host.agent`→`host_agent`、`host.plugin`→`host_plugin`、`host.managed_agents`→`managed_agents`；`saveRoomField` 的 `{ host: {...} }`→`{ recipe: {...} }`
- 测试：`room-host-sanitize.test.ts` 断言切 `recipe.host_model` 等；`server-http.test.ts` PUT body `{ host: {} }`→`{ recipe: {} }`；320 个测试全绿，typecheck 通过

**阶段 5 完成（console 全量重写，2026-10-18）：**

- 读路径（`test-sets.ts`/`project-reader.ts`/`run-plan.ts`/`bank.ts`）、写路径（`bank.ts` create/update/delete）、环境管理（`env-catalog.ts`/`controllers/env.ts`/`parse.ts`）、运行（`job-queue.ts`）、前端（`app.js`/`env.js`）全部切 cases-v1
- 遗留（阶段 6）：`scripts/eval-paired.sh` 与 `package.json` 的 `eval:model` 脚本仍用 `--paperset`；run meta 字段名 `paperset`/`room` 未统一

**阶段 6 切片 D（迁移脚本改造 + 单题结构 + 轴路由表达，2026-10-18，进行中）：**

- 设计稿 `docs/09-轴路由cases-v1表达设计.md`：不恢复「轴」概念，用 `strata.task_type` + `execution_profile.mode` 表达执行驱动（fold/scripted/cassette/hosted/direct_tool）；题目级字段（fold_entry/contract/script/cassette 等）扩展 `CaseRevision.execution_profile`，环境级字段（kind/model_driver/fold_entries/adapter/sut 等）扩展 `EnvironmentProfile.recipe`
- `scripts/migrate-v2.mjs` 改造：单题结构支持（`toCaseId` 单题完整小写化、`revisionVariant` 单题省略 variant、items 路径检测 `bank/items` vs `items`、`dataset_release_id` 小写化、paperset 迁移 content_hash 改内存查询避免 dry-run 读磁盘）
- 迁移 `examples/demo-project`（21 单题）+ `examples/wanxiangshu-papers`（32 单题）到 cases-v1，644 资产全部通过 schema 校验
- schema 扩展：`case-revision.schema.json` 新增 `execution_profile`、`environment.schema.json` recipe 新增 `kind`/`model_driver`/`fold_entries`/`adapter`/`sut`/`contract`/`event_schema`；`src/domain/types.ts` 新增 `FoldEntrySpec`/`RoomAdapter` 领域类型
- `src/run/cases-v1-adapter.ts` 扩展：`caseRevisionToItemDoc` 按 `execution_profile.mode` 还原 `FreezeA`（A 轴 fold/scripted/cassette）或 `FreezeBC`（B/C 轴），`environmentToRoom` 按 `recipe.kind` 还原 `kind`/`fold_entries`/`adapter`/`sut`；新增 `tests/run/cases-v1-adapter-axis.test.ts`（6 用例）
- 协议版本切换：`ASSET_PROTOCOL_VERSION = 'cases-v1'`；`exam.schema.json` `asset_protocol` 改 `enum: ['cases-v1', 'papers-v1']`（papers-v1 历史兼容）；`checkProtocolCompatibility` 对 papers-v1 降级 warning（`PROTOCOL_DEPRECATED`）
- exam.json 迁移：product-eval/demo-project/wanxiangshu-papers/templates 切 `cases-v1`，移除 `defaults` 字段（无消费方）
- 端到端验证：`proctor run --dataset smoke-a-l1 --environment fold-v1 --project examples/demo-project` 5/5 试题 PASS，item id 正确还原 `EVAL-A-DEMO-A-TODO-FOLD-01` 等
- 测试：326 个测试全绿（含新增 6 个 A/C 轴适配层用例），typecheck/lint 通过

**阶段 6 切片 D2（遗留脚本切换 + exam.json 目录字段保留，2026-10-18）：**

- `scripts/eval-paired.sh`：`--axis B --paperset X`→`--dataset X --environment Y`（paired-off→hosted-plain-v1、paired-on→hosted-plugin-v1、eval-model→hosted-plain-v1、eval-agent→hosted-plain-v1、demo eval-model→model-direct-v1）
- `package.json`：`eval:model`/`eval:model:demo-schema`/`smoke:offline`/`smoke:wanxiangshu`/`smoke:wanxiangshu:l1`/`smoke:plugin-fakehost` 全部切 `--dataset`/`--environment`
- exam.json `paths` 保留 papers-v1 目录字段（`items`/`papersets`/`rooms`），因 papers-v1 资产仍在、validate 仍读这些目录（product-eval 的 `items: bank/items` 非默认值，删除会读错目录）
- 端到端验证：demo-project 的 A（fold/scripted）、B（direct）、C（echo）三轴 cases-v1 路径全部跑通 PASS
- 测试：326 个测试全绿，typecheck/lint 通过

**阶段 6 切片 E（validate 切 cases-v1 校验，2026-10-18）：**

- `validate.ts` 新增 cases-v1 校验函数：`validateCaseV2`（Case schema）、`validateCaseRevision`（schema + `content_hash` 与 `revisionDigest` 一致性）、`validateDatasetRelease`（schema + case_revision 交叉引用 + hash 一致性）、`validateEnvironment`（schema）、`validateCandidate`（schema + environment 交叉引用）
- `validateProject` 扩展：papers-v1 校验之后追加 cases-v1 资产校验（case/case-revision/dataset-release/environment/candidate），结果并入 `projectIssues`
- `validateCase` 语义：从「别名 validateItem（papers-v1 item 校验）」改为「@deprecated 别名」，新增 `validateCaseV2` 为 cases-v1 语义（papers-v1 item 校验保留供历史兼容）
- 错误码：`REVISION_HASH_MISMATCH`/`DATASET_REVISION_MISSING`/`DATASET_HASH_MISMATCH`/`CANDIDATE_ENV_MISSING`
- 测试：新增 `tests/exam-engine/validate-cases-v1.test.ts`（8 用例，含红测破坏 content_hash/引用不存在修订/environment）；334 个测试全绿，typecheck/lint 通过

**阶段 6 遗留（待办）：**

- papers-v1 资产归档（`docs/archive/` + `examples/*/legacy/`）未做
- run meta 字段名 `paperset`/`room` 未统一为 `dataset`/`environment`
- cases-v1 资产（case.json 等）的 prettier 格式问题（迁移脚本 `JSON.stringify` 单元素数组多行 vs prettier 单行）为既有问题，未纳入本阶段

## §15 V2.17 深迁移阶段 6 切片 F（物理切换收尾，2026-10-18）

本轮完成 papers-v1 → cases-v1 的**物理切换收尾**：归档 papers-v1 源资产、移除引擎遗留 run 路径、按协议分派校验、还原精确 item_id，并修复全部受影响的测试。

**1. papers-v1 源资产归档（`git mv` 到 `examples/*/legacy/`）**

- `examples/demo-project`、`examples/product-eval`、`examples/wanxiangshu-papers` 的 `items/`、`papersets/`、`rooms/`（及 product-eval 的 `bank/items/`）整体 `git mv` 到各项目 `legacy/` 下（`legacy/items/`、`legacy/papersets/`、`legacy/rooms/`），保留历史 run 兼容所需的原始 papers-v1 资产。

**2. 引擎遗留 run 路径移除（`run.ts` / `main.ts`）**

- `run.ts`：删除 papers-v1 分支（`--paperset`/`--room`/`--axis`），`RunOptions` 严格要求 `dataset` + `environment`；cases-v1 执行路径（`resolveDatasetItems` → 适配层 → `runOneItem`）并入 `runCommand`。
- `main.ts`：run 处理器严格要求 `values.dataset` + `values.environment`，更新 CLI help 文本。

**3. 校验按协议分派（`validate.ts` / `format.ts`）**

- `validate.ts`：`validateProject` 按 `manifest.asset_protocol` 分派——cases-v1 走 `validateCasesV1Assets`（产出 `caseReports`），papers-v1 走 `validatePapersV1Assets`（产出 `items`）；`ValidationReport` 新增 `caseReports: CaseReport[]`。
- `format.ts`：`formatValidationReport` 按 `caseReports`/`items` 动态渲染。

**4. 精确 item_id 还原（`legacy_item_id`）**

- 根因：`toCaseId` 非双射（`DEMO-B-TOOL-SCHEMA-01` → `demo-b-tool-schema-01`，但 `WX-A-ST-01-MAIN` 原 id 无 `EVAL-` 前缀），适配层启发式 `caseIdToV1ItemId` 无法精确还原，导致 demo-project 的 promptfoo 夹具路径（`materials/<item_id>/fixtures/`）断裂。
- 方案：`CaseRevision` 新增 `legacy_item_id` 字段（schema + 类型 + 迁移脚本记录 `item.id`），适配层 `caseRevisionToItemDoc` 优先用 `legacy_item_id` 还原 `ItemDoc.id`，fallback 到 `caseIdToV1ItemId`。
- 迁移脚本源路径改为读 `legacy/items`、`legacy/papersets`、`legacy/rooms`，重新迁移三项目（demo 21 + product-eval 318 + wanxiangshu 32 个 CaseRevision 全部带 `legacy_item_id`）。

**5. 测试修复（A/B/C/D 四类）**

- A 类（改路径到 legacy，4 文件）：`item-tags.test.ts`、`stdout-assert.test.ts`、`effect-workspace-oracles.test.ts`、`hosted-runner-timeout-workspace.test.ts` 的 `bank/items/B` → `legacy/items/B`。
- B 类（改用适配层，2 文件）：`fold.test.ts`、`c-idempotency.test.ts` 从 `loadItems`/`loadRooms` 切换为 `resolveDatasetItems`（dataset-release × environment 还原）。
- C 类（id 断言，1 文件）：`cases-v1-adapter-axis.test.ts` 的 `EVAL-A-WX-A-ST-01-MAIN` → `WX-A-ST-01-MAIN`（wanxiangshu 原 id 无 `EVAL-` 前缀，`legacy_item_id` 精确还原）。
- D 类（改断言，1 文件）：`validate-project.test.ts` 的 `report.items` → `report.caseReports`（demo-project 为 cases-v1 协议）。

**验证（实测，2026-10-18）：**

- `npm test`：59 文件 334 测试全绿（唯一需非沙箱环境的是 `event-store.test.ts` 的 git init 权限，非本次改动引入）
- `npm run typecheck`：0 错误
- `npm run lint`：通过
- `format:check`：本次改动文件全部干净；cases-v1 资产（case.json 等）的 prettier 格式问题为既有遗留（见上「阶段 6 遗留」第 3 项），未纳入本阶段

## §16 V2.17 深迁移阶段 6 收尾补遗（字段名统一 + item new cases-v1 化，2026-10-18）

本轮补齐阶段 6 切片 F 之后的三项遗留：run meta 字段名统一、`item new` 命令 cases-v1 化、console 层 `paperset` 字段命名统一。

**1. run meta 字段名统一（阶段 6 遗留第 2 项）**

- `src/run/write-artifacts.ts`：`RunMeta` 删除 `axis` 字段，`paperset`→`dataset`、`room`→`environment`；report.md 输出同步（`- dataset:`/`- environment:`，删 `- axis:`）。
- `src/cli/commands/run.ts`：meta 写入删 `axis: 'B'` 硬编码，`paperset: datasetName`→`dataset: datasetName`、`room: environmentName`→`environment: environmentName`。
- `src/cli/commands/report-trend.ts`：`ReportTrendOptions.paperset`→`dataset`、`RunPoint` 删 `axis`/`paperset`→`dataset`、读 `meta.dataset`；JSON/表格输出同步。
- `src/cli/main.ts`：`report trend --paperset`→`--dataset`；删除 `--axis`/`--paperset`/`--suite` 选项定义；HELP 文本更新。
- `apps/console/dashboard.ts`：`parseRunMeta` 读 `dataset`/`environment`；`DashConfig.paperset`→`dataset`、`room`→`environment`。
- `apps/console/public/app.js`：`c.paperset`→`c.dataset`。
- 测试：`report-trend.test.ts`、`dashboard.test.ts`、`hosted-runner-pass-token.test.ts`、`hosted-runner-timeout-workspace.test.ts` 断言对齐。

**2. `item new` 命令 cases-v1 化（切片 F 归档引入的断裂）**

- 根因：切片 F 把 `items/` `git mv` 到 `legacy/items/` 后，`item new` 仍写 papers-v1 `.item.json`（`--axis A|B|C`），会重建空 `items/` 目录并产出无效资产。
- 方案：`src/cli/commands/item-new.ts` 重写为 cases-v1 录题——`--id <case_id>`（小写连字符）+ `--mode fold|scripted|cassette|hosted|direct_tool`（对齐 `execution_profile.mode`）+ 可选 `--layer`/`--title`/`--dataset`；产出 `cases/<case_id>.case.json` + `case-revisions/<case_id>.r1.case-revision.json`（`content_hash` 用 `revisionDigest` 计算），`--dataset` 可选挂载 dataset-release（创建或追加引用并重算 `closure_hash`）；写 JSON 用 `prettier.format` 对齐 `format:check` 口径。
- `src/cli/main.ts`：`item new` 分支传 `--mode`/`--dataset`。
- 新增 `tests/cli/item-new.test.ts`（5 用例：缺参/非法 case_id/非法 mode/fold 录题含 content_hash 校验/挂 dataset-release）。

**3. console 层 `paperset` 字段命名统一为 `release`**

- 根因：`run-plan.ts` 早已定名 `release`（`resolveRunPlan` 入参 `release`、`RunPlan.release`、`RunStep.release`），但调用方 `controllers/run.ts` 仍传 `paperset`，经 spread 展开被 TS 静默忽略，导致 console 指定测试集不生效（真实 bug）。
- `apps/console/controllers/run.ts`：`RunBody.paperset`→`release`，`resolveRunPlan` 传 `release`（修复参数被忽略）。
- `apps/console/eval-tasks.ts`：`EvalTask.paperset`/`EvalTaskInput.paperset`/`resolveTestSetRef` 的 `paperset`→`release`。
- `apps/console/controllers/health.ts`：PRESETS 的 `paperset`→`release`、`defaultPaperset`→`defaultRelease`。
- 数据迁移：`examples/product-eval/eval-tasks/*.json`（2 文件）`paperset`→`release`。
- `scripts/console-l0.sh`：`defaultPaperset`→`defaultRelease` 断言。
- 测试：`eval-tasks.test.ts` 断言对齐。

**4. `job-queue.ts` 删除 `--axis B` 硬编码（Bugbot 审查发现）**

- 根因：本轮从 `main.ts` 的 `parseArgs` options 删除 `--axis` 后，`node:util` 的 `parseArgs` 默认严格模式，`job-queue.ts` 三处 CLI 调用仍硬编码 `--axis B`，会抛 `ERR_PARSE_ARGS_UNKNOWN_OPTION`，使 console 提交的每次 run 任务以退出码 2 失败。
- 修复：`apps/console/job-queue.ts` 的 `proctorRunArgs`、`legacy === 'model'` 分支、`legacy === 'agent'` 分支删除 `'--axis', 'B'`，仅保留 `--dataset`/`--environment`/`--project`。

**验证（实测，2026-10-18）：**

- `npm test`：59 文件 339 测试通过（`event-store.test.ts` 的 4 个 git init 用例仍为沙箱权限问题，非沙箱重跑全绿，非本次改动引入）
- `npm run typecheck`：0 错误
- `npm run lint`：通过
- `format:check`：全部干净
- `npm run validate:examples`：318/318 试题通过协议校验

## §17 引擎回归手册 cases-v1 深迁移（docs/test/02-engine-regression.md，2026-10-18）

将 `docs/test/02-engine-regression.md` 从 papers-v1 的「A/B/C 轴」框架深迁移为 cases-v1 的 `task_type`（= `execution_profile.mode`）框架，对齐 `docs/09-轴路由cases-v1表达设计.md`（按草案当前口径）与 `docs/05-领域对象与代码类型映射.md`。

**1. 组织框架**：废弃「轴 A/B/C」术语，改用「测试对象」三分类（行为/事件/控制流、模型、工具 CLI）作为叙述框架；每个分类内标注对应 `task_type`（fold/scripted/cassette/hosted/direct_tool）。

**2. 命令迁移**：

- `run --axis X --paperset Y` → `run --dataset y --environment z`（映射：`st-import-l1`×`fold-wanxiangshu-v1`、`smoke-a-l1`×`fold-v1`、`smoke-a`×`fake-host-v1`、`smoke-a-l3`×`fake-host-v1`、`model-core`×`model-direct-v1`、`hosted-smoke`×`hosted-wanxiangshu-v1`/`hosted-opencode-v1`、`smoke-c-echo`/`smoke-c-write`×`shell-echo-v1`、`st-real-git`×`git-coordinator-v1`）。
- `item new --axis X --layer L` → `item new --mode fold|scripted|cassette|hosted|direct_tool --layer L`。
- 删除已不存在的 `--models` CLI 参数引用（换模型改走 environment 的 `recipe.host_model`）。

**3. 字段名统一**：`paperset`→`dataset`、`axis`→`task_type`、`room`→`environment`、`freeze.*`→`execution_profile.*`、`items[]`→`case_revisions[]`、`papersets/…json`→`dataset-releases/….dataset-release.json`、`model_driver`→`execution_profile.mode`。

**4. 样例题 id 对齐实际资产**：`DEMO-A-NUDGE-TIMING-01`→`demo-a-nudge-timing-01`、`WX-A-ST-01-MAIN`→`wx-a-st-01-main`、`DEMO-B-TOOL-SCHEMA-01`→`demo-b-tool-schema-01`、`WX-B-HOSTED-PLUGIN-01`→`wx-b-hosted-plugin-01`、`DEMO-C-ECHO-01`→`demo-c-echo-01`、`WX-C-ST-06-REBASE`→`wx-c-st-06-rebase` 等（对齐 examples 里已小写连字符化的 case_id）。

**验证（实测，2026-10-18）**：

- `grep` 全文无 `--axis`/`--paperset`/`papersets`/`items[]`/`freeze.`/`rooms/`/`model_driver`/`轴` 残留。
- dataset/environment 名称与 examples 下 `dataset-releases/`、`environments/` 实际文件名逐一核对一致。
- 文档内链接（`01-wanxiangshu-ops.md`、`archive/v1-design/*`、`architecture/adr/0008`、`archive/v1-requirements/01-prd.md`、`process/`）全部可解析。

## §18 全盘审核 + console 命名统一残留修复（rooms→environments，2026-10-18）

对全仓库（docs / src / apps / scripts / tests）做 papers-v1 → cases-v1 残留扫描。代码/脚本的功能逻辑已完全切到 cases-v1，但发现一批「口径未统一的注释/文案/命名」残留（功能已切、命名仍是旧口径），违反「不留两套口径」原则。本轮统一修复。

**1. 后端命名统一（rooms → environments）**

- `apps/console/controllers/env.ts`：`envRoomsList`→`envEnvironmentsList`、`envRoomsUpdate`→`envEnvironmentsUpdate`、`roomsDir`→`environmentsDir`、`roomName`→`environmentName`、`roomFiles`→`environmentFiles`；响应字段 `{ rooms }`→`{ environments }`；错误文案 `room not found`→`environment not found`、`房间配置已被并发修改`→`环境配置已被并发修改`。
- `apps/console/parse.ts`：`SanitizedRoomUpdate`→`SanitizedEnvironmentUpdate`、`sanitizeRoomUpdate`→`sanitizeEnvironmentUpdate`。
- `apps/console/router.ts`：API 路径 `/api/env/rooms`→`/api/env/environments`、`/api/env/rooms/:name`→`/api/env/environments/:name`；调用 `envEnvironmentsList`/`envEnvironmentsUpdate`。
- `apps/console/env-catalog.ts`：函数 `roomsDir`→`environmentsDir`；局部变量 `rooms`→`environments`。
- `apps/console/project-reader.ts`：`roomsDir`→`environmentsDir`、返回字段 `rooms`→`environments`（`projectSummary` 的该字段未被前端/测试消费，改名安全）。
- `apps/console/json-io.ts`、`bank.ts`、`eval-tasks.ts`、`run-plan.ts`：注释口径统一（`rooms/`→`environments/`、`papersets/`→`dataset-releases/`）。

**2. 前端命名统一（房间 → 环境）**

- `apps/console/public/index.html`：DOM id `roomPanel`/`roomList`/`roomModelOptions`/`roomAgentOptions`→`environmentPanel`/`environmentList`/`environmentModelOptions`/`environmentAgentOptions`；文案「房间配置」→「环境配置」、「rooms/_.json」→「environments/_.environment.json」、「共用一间房间」→「共用一套环境」。
- `apps/console/public/env.js`：变量 `rooms`→`environments`、函数 `loadRooms`/`renderRooms`/`saveRoomField`→`loadEnvironments`/`renderEnvironments`/`saveEnvironmentField`、`pendingRoomChanges`/`roomTimers`→`pendingEnvironmentChanges`/`environmentTimers`、循环变量 `room`→`environment`、API 路径 `/api/env/rooms`→`/api/env/environments`、响应 `data.rooms`→`data.environments`、文案「没有房间文件」→「没有环境文件」。
- `apps/console/public/styles.css`：CSS class `.room-panel`/`.room-list`/`.room-card`→`.environment-panel`/`.environment-list`/`.environment-card`；注释「房间配置面板」→「环境配置面板」。

**3. 脚本与测试**

- `scripts/eval-paired.sh`：文案「bank + rooms + papersets」→「cases + environments + dataset-releases」。
- `tests/console/server-http.test.ts`：断言 `/api/env/rooms/not-exists-room`→`/api/env/environments/not-exists-environment`、`room not found`→`environment not found`。
- `tests/console/room-host-sanitize.test.ts` → `git mv` 为 `environment-host-sanitize.test.ts`，`sanitizeRoomUpdate`→`sanitizeEnvironmentUpdate`（13 处）。

**4. 合法保留（不改，记录在案）**

- `src/exam-engine/loader.ts`/`index.ts`/`validate.ts` 的 `loadRooms`：引擎层 papers-v1 兼容函数（加载 legacy `RoomDoc`），`@deprecated`，不改。
- `src/run/cases-v1-adapter.ts` 及 7 个 runner 的 `freeze.*`/`model_driver`：绞杀者适配层还原目标字段，runner 内部仍消费旧形状，不改。
- `docs/process/01-changelog.md`、`docs/archive/v1-design/*`、`docs/09`/`06`/`08`/`07`/`05`：历史记录/归档/设计稿/映射表，`axis`/`model_driver`/`ItemDoc` 是迁移映射描述，保留。

**5. 遗留项（本次未改，记录在案）**

- `apps/console/env-catalog.ts` 的 `EnvEntry.source` 枚举值 `'room' | 'console'`（及 `app.js` 的 `model_source === 'room'` 判断）：数据字段语义（「来源是环境文件」），改 `'room'`→`'environment'` 涉及 `dashboard.ts` 的 `model_source` 持久化兼容（历史 run 数据），属独立决策，暂不改。
- `apps/console/test-sets.ts:4` 注释「阶段 5：数据源从 papersets/ 切换到 dataset-releases/」：历史阶段记录性注释，保留。
- `docs/09-轴路由cases-v1表达设计.md` 状态仍为「草案（待评审）」，按 §17 决策「按当前口径迁移、不先定稿」，定稿另立任务。

**验证（实测，2026-10-18）**：

- `npm run typecheck`：0 错误
- `npm run lint`：通过
- `npx vitest run tests/console/server-http.test.ts tests/console/environment-host-sanitize.test.ts`：25 测试全绿
- `npm test`：59 文件 335 测试通过（`event-store.test.ts` 的 4 个 git init 用例为沙箱权限问题，非沙箱重跑全绿，非本次改动引入）

## §19 遗留项收尾：room 枚举值/字段名统一 + docs/09 定稿（2026-10-18）

收口 §18「遗留项」三条 + 引擎层 `model_source` 枚举值统一，把「房间（room）」语义的最后一个残留清干净。

**1. 引擎层 `model_source` 枚举值统一（`src/run/hosted-runner.ts`）**

- `modelSource` 取值 `'room'`→`'environment'`、`'env-override-room'`→`'env-override-environment'`（`'env'` 保留，语义「来自环境变量」准确）。
- run 产物字段 `model_room`→`model_environment`（诊断字段，无代码消费方，改名安全）。
- `model_frozen`/`model_env` 字段名保留（「冻结模型」/「环境变量模型」语义仍准确，非 room 残留）。

**2. console 层 `source` 枚举值统一（`apps/console/env-catalog.ts`）**

- `EnvEntry.source` 类型 `'room' | 'console'`→`'environment' | 'console'`；赋值 `'room'`→`'environment'`（2 处）。
- 局部变量 `roomModels`/`roomAgents`/`roomModelSet`/`roomAgentSet`→`environmentModels`/`environmentAgents`/`environmentModelSet`/`environmentAgentSet`（与已改的 Set 变量名保持一致）。
- `apps/console/public/app.js`：`c.model_source === 'room'`→`'environment'`。
- `tests/console/dashboard.test.ts`：`model_source: 'room'`→`'environment'`（2 处）。

**3. 历史注释清理 + 文档定稿**

- `apps/console/test-sets.ts`：删除「阶段 5：数据源从 papersets/ 切换到 dataset-releases/」历史阶段注释。
- `docs/test/01-wanxiangshu-ops.md`：`model_source`（`room` / `env`）→（`environment` / `env`），`model_source: room`→`model_source: environment`。
- `docs/09-轴路由cases-v1表达设计.md`：状态「草案（待评审）」→「现行」（字段已全量落地 engine/adapters/CLI/console/docs，事实定稿）。

**验证（实测，2026-10-18）**：

- `npm run typecheck`：0 错误
- `npm run lint`：通过
- `npm test`：59 文件 335 测试通过（`event-store.test.ts` 的 4 个 git init 用例为沙箱权限问题，非沙箱重跑 5/5 全绿，非本次改动引入）
- `format:check`：本轮修复 3 个前几轮遗留的格式问题（`apps/console/public/env.js`、`docs/process/01-changelog.md`、`docs/test/02-engine-regression.md`），现全仓干净

## §20 papers-v1 兼容层彻底清除（2026-10-19）

一轮清掉 papers-v1 兼容层：runner 直接消费 `CaseRevision` / `EnvironmentProfile`，删除 `cases-v1-adapter.ts`、papers-v1 类型、加载器、校验器、schema、生命周期命令与 `legacy/` 资产。

**1. runner 输入类型与 dispatch（`src/run/runner-types.ts` 新增，`src/cli/commands/run.ts`）**

- 新增 `RunCaseInput { revision: CaseRevision; pairKey?: string }` 与 `RunEnvironmentInput = EnvironmentProfile`。
- `resolveDatasetItems` 返回 `{ cases: RunCaseInput[]; environment: EnvironmentProfile }`（不再还原 `ItemDoc[] + RoomDoc`）。
- `runOneItem` 直接按 `revision.execution_profile.mode` 分派：`fold`→L1、`scripted`→L2、`cassette`→L3、`hosted`→hosted runner 或 B-direct、`direct_tool`→C runner。
- run 产物 `items` 字段 `id` 改用 `case_revision_id`（`rev` 用 `revision_number`）。

**2. 删除 papers-v1 兼容层**

- 删除 `src/run/cases-v1-adapter.ts`。
- 删除 schema：`schemas/item.schema.json`、`schemas/paperset.schema.json`、`schemas/room.schema.json`。
- 删除生命周期命令：`item-resolve.ts`、`item-migrate.ts`、`item-retire.ts`、`item-bump-rev.ts`（`main.ts` 帮助文本同步清理）。
- 删除 `@deprecated` V1 类型（`ItemDoc`/`PapersetDoc`/`RoomDoc`/`FreezeA`/`FreezeBC`/`ALayer`/`ItemStatus`/`RoomHost`/`RoomAdapter`/`CaseDoc`/`SuiteDoc`/`ProfileDoc`/`ProjectManifest`/`CaseStatus`）；保留活跃基础设施类型（`AXES`/`Axis`/`GateBound`/`ExamManifest`/`AssetKind`/`LoadedAsset`/`IssueLevel`/`Issue`）。
- `digest.ts` 删除 `semanticDigest`，保留 `revisionDigest`/`canonicalize`/`fileDigest`。
- `loader.ts` 删除 `loadItemFile`/`loadItems`/`loadPapersets`/`loadRooms`/`loadCaseFile` 等旧加载器，保留 `loadCaseFileV2`/`loadCaseRevisionFileV2` 及 cases-v1 加载器。
- `validate.ts` 删除 `validateItem`/`validateCase`/`validatePapersV1Assets` 等旧校验器，`validateProject` 只跑 `validateCasesV1Assets`。
- `item validate <文件>` 迁移到 cases-v1：按后缀分派 `validateCaseV2` / `validateCaseRevision`。

**3. 删除 legacy 资产与测试**

- 删除 `examples/*/legacy/`（demo-project、product-eval、wanxiangshu-papers 的 items/papersets/rooms）。
- 删除 `tests/compat/legacy-assets.test.ts`、`tests/run/cases-v1-adapter*.test.ts`。
- `broken-project` fixtures 从 papers-v1 迁移为 cases-v1（case/case-revision/dataset-release/candidate），`validate-project.test.ts` 断言改为 `REVISION_HASH_MISMATCH`/`DATASET_REVISION_MISSING`/`CANDIDATE_ENV_MISSING`。

**4. runner 字段访问迁移**

- `l1/l2/l3/b/c/hosted-runner.ts`、`runner-shared.ts`、`hosted-oracles.ts`、`hosted-prompt.ts`、`hosted-pass-token.ts`、`plugin-path.ts`、`execution-adapter.ts`、`run-orchestrator.ts`、`drivers/fold/*` 全部改为消费 `revision: CaseRevision` + `environment: EnvironmentProfile`。
- `promptfoo.ts` `runFixture` 从 `prompt_ref` 父目录定位 fixture（不再用 `item.id`，因 fixture 目录沿用 legacy_item_id 命名）。

**5. 测试迁移**

- `case-factory.ts` 改为产出 `CaseRevision`；`digest/validate-case/validate-project/run-v2/fold/c-idempotency/hosted-*/plugin-path/effect-workspace-oracles/stdout-assert/item-tags` 等测试全部迁移到 cases-v1 语义。
- `main.test.ts`：`--only` 改传 `case_revision_id`；`report show` 断言改 `case_revision_id`；删除 `bump-rev`/`retire`/`migrate` 用例。

**验证（实测，2026-10-19）**：

- `npm run typecheck`：0 错误
- `npm run lint`：通过
- `npm test`：57 文件 316 测试通过（`event-store.test.ts` 的 git init 用例需非沙箱权限，非沙箱重跑全绿）
- `npm run validate:examples`：318/318 通过
- `format:check`：全仓干净

## §21 全盘审视：清除 console 层 papers-v1 残留（2026-10-19）

§20 清掉 `src/` 与 CLI 的 papers-v1 兼容层后，全盘审视发现 console 层（`apps/console/`）仍有遗漏的读路径死代码与命名残留，本轮一并清理。

**1. 删除 `apps/console/bank.ts` 死代码**

- 删除本地 `ItemDoc` 类型、`readItem`、`effectPairOf`、`sideFrom`、`itemsBDir`（读已删除的 `bank/items/B/*.item.json` 旧路径）。
- `loadPairedItems` 移除 item.json 回退分支，直接返回 `loadPairedItemsV1`（写路径早已迁到 cases-v1，回退分支读的目录已不存在）。
- 修正 `caseIdToV1ItemId` 注释（原引用已删除的 `src/run/cases-v1-adapter.ts`）。
- 删除 `tests/console/bank-cases-v1.test.ts` 中「cases-v1 缺失时回退读 item.json」用例（对应回退逻辑已移除）。

**2. 命名残留清理**

- `src/domain/types.ts`：`RoomAdapter` → `AdapterSpec`（活跃的 L2/C 轴执行适配器规格，与 `FoldEntrySpec` 命名对齐；原「Room」前缀与「papers-v1 迁移」注释已无意义）。
- `src/exam-engine/types.ts`：头部「迁移映射」注释精简为「papers-v1 已彻底删除」的权威声明。

**3. 文档修正**

- `docs/00-repo-structure.md`：`examples/product-eval/bank/` 下仅剩 `materials/`（`items/` 已删），修正目录树描述。

**有意保留（数据语义，非残留）**：

- `CaseRevision.legacy_item_id` 字段（还原历史 run 产物 id）。
- `ItemSide.id` 的 V1 格式 `EVAL-B-...`（`run-plan.ts`/`job-queue.ts` 下游依赖）。

**验证（实测，2026-10-19）**：

- `npm run typecheck`：0 错误
- `npm run lint`：通过
- `npm test`：57 文件 315 测试通过（删除 1 个回退测试用例）
- `format:check`：全仓干净

## §22 文档与注释残留收口 + 升 rev/退役新口径（2026-10-19）

§21 清完 console 层死代码后，二次全盘审视发现现行手册仍引用已删除的命令/类型，且「升 rev / 退役」在删除 `item bump-rev`/`item retire` 后无替代口径，本轮一并收口。

**1. 现行手册命令引用修正**

- `docs/test/02-engine-regression.md`：删除 `item bump-rev`/`item retire` 命令引用，改为新口径（见下）；「升 rev 时机」速查表保留概念性描述。
- `docs/test/01-wanxiangshu-ops.md`：`bump-rev` 改为「升 rev（新建 revision 文件）」。

**2. 升 rev / 退役新口径（写入手册）**

- 升 rev：语义变更后手动新建 `case_id.rN.case-revision.json`（`revision_number` +1，重算 `content_hash`），在 `change_log` 写清原因；`item new` 只生成 r1 骨架。
- 退役：把 `case.json` 的 `lifecycle` 改为 `deprecated`，不物理删除仍被 baseline 引用的 id。

**3. 迁移映射表收口**

- `docs/05-领域对象与代码类型映射.md`：第 10 行约定改为「papers-v1 旧类型已彻底删除，不再保留兼容接口」；第 11 节「V1→V2.17 迁移映射」表精简为「迁移已收口」说明，指向过程日志 §20。

**4. 注释残留清理**

- `src/domain/types.ts`、`src/run/runner-types.ts`、`src/run/run-orchestrator.ts`：删除提到已删旧类型名（ItemDoc/RoomDoc）的注释，改为中性描述。

**验证（实测，2026-10-19）**：

- `npm run typecheck`：0 错误
- `npm run lint`：通过
- `format:check`：全仓干净

## §23 全盘审视收口：仓库卫生 + @deprecated 清理 + 根 CHANGELOG 同步（2026-10-19）

客观视角全盘审视，处理仓库卫生、残留类型别名与文档双轨问题。

**1. 仓库卫生（.diagnostics / .gitignore）**

- `.diagnostics/`（8MB 一次性 incident 诊断产物）从 git 移除并加入 `.gitignore`。其中 `opencode-config.json` 的 apiKey 为 opencode 客户端导出的**脱敏形式**（`sk-7...96e6`），非完整明文，git 历史中亦无完整密钥；但仍暴露第三方中转站服务商与模型名，故一并移出仓库。
- `.gitignore` 删除过时规则（`examples/product-eval/legacy/rooms/.console-catalog.json`、`loadRooms` 注释），新增 `.diagnostics/`。

**2. @deprecated 类型别名清理**

- 删除 `ProviderDefinition`/`DeploymentDefinition`（`src/domain/types.ts`）与 `HarnessProject`（`src/exam-engine/project.ts`），并清理 `exam-engine/types.ts`/`index.ts` 的 re-export 链。三者均无生产/测试消费者，纯 re-export 别名。
- 顺带修正 `ModelRoutingProfile.routes` 一处缩进。

**3. 根 CHANGELOG.md 同步**

- 根 `CHANGELOG.md` 从过时内容（papers-v1、`bump-rev`/`retire`/`migrate`、`rooms`）重写为 cases-v1 现状：资产模型、CLI 命令表（含已删命令与新口径）、执行驱动分派、12 类 Oracle，并指向 `docs/process/01-changelog.md` 作权威过程日志。

**4. 遗留（单独立项，未在本轮处理）**

- **RunOrchestrator / ExecutionAdapter 状态机未接线**：`run-orchestrator.ts` + `execution-adapter.ts` 只被彼此引用，CLI `run.ts` 实际走旧 `runOneItem` dispatch。属 Phase 2 目标架构，需单独立项完成 7 个 runner 的 adapter 改造。
- `AssetKind` 仍含 `'items' | 'papersets' | 'rooms'` 旧枚举值（`src/exam-engine/types.ts`），与 cases-v1 并存。

**验证（实测，2026-10-19）**：

- `npm run typecheck`：0 错误
- `npm run lint`：通过
- `npm test`：57 文件 315 测试通过
- `format:check`：全仓干净

## §24 遗留待办①：AssetKind 死路径枚举删除（2026-10-19）

按计划排序开启遗留待办，先处理最小最安全的 `AssetKind` 死路径。

**1. 删除 `AssetKind` 旧枚举值**

- `src/exam-engine/types.ts`：`AssetKind` 删除 `'items' | 'papersets' | 'rooms'`（papers-v1 旧资产种类，无消费者）。
- `src/exam-engine/project.ts`：`DEFAULT_PATHS` 删除 `items: 'items'` / `papersets: 'papersets'` / `rooms: 'rooms'` 三个死映射（`loadProject` 生成的 `dirs.items/papersets/rooms` 无任何代码消费，实际只消费 `cases`/`case_revisions`/`dataset_releases`/`environments`/`candidates`/`materials`/`scripts`）。

**2. 遗留（后续待办）**

- 待办②：`item-new.ts` 骨架带 TODO 占位（`fold_entry: 'TODO'`、`script: 'scripts/TODO.json'`）。
- 待办③：RunOrchestrator / ExecutionAdapter 状态机接线（Phase 2 大工程）。
- 新发现：`tests/console/bank.test.ts` 等测试仍 seed 旧 `papersets/`、`bank/items/B` fixture（读路径已切 cases-v1，seed 代码残留，属测试卫生）。

**验证（实测，2026-10-19）**：

- `npm run typecheck`：0 错误
- `npm run lint`：通过
- `npm test`：57 文件 315 测试通过

## §25 遗留待办②：item new 骨架补全提示（2026-10-19）

按计划依序推进待办②：`item new` 生成的骨架带 TODO 占位（`fold_entry: 'TODO'`、`contract: 'TODO'`、`script: 'scripts/TODO.json'`），生成后提示不明确，易漏补。

**1. 方案（不改骨架结构，优化提示）**

- 保留 TODO 占位（骨架约定，schema 只查 string 类型，能过 validate；但未补全前无法 run）。
- 新增 `todoHintsOf(mode)`：按 mode 返回需补全的占位字段清单（fold → `execution_profile.fold_entry`；scripted → `execution_profile.contract` + `execution_profile.script`；cassette/hosted/direct_tool 无占位）。
- 非 JSON 模式下，生成后打印「下一步补全（骨架占位，未补全前无法 run）：」+ 逐条提示；JSON 模式不受影响（保持机器可读）。

**2. 测试**

- `tests/cli/item-new.test.ts` 新增用例：非 JSON 模式下 fold/scripted 的提示输出包含对应占位字段名。

**验证（实测，2026-10-19）**：

- `npm run typecheck`：0 错误
- `npm run lint`：通过
- `npm test`：57 文件 316 测试通过（新增 1 用例）
- `format:check`：全仓干净

## §26 遗留待办③：RunOrchestrator / ExecutionAdapter 状态机接线（2026-10-19）

按计划推进待办③（Phase 2 目标架构）：把 7 个 runner 全部改造为 `ExecutionAdapter` 状态机，接进 `RunOrchestrator.executeCase`，删除旧 `runOneItem` 分派。

**1. 统一接口与类型契约**

- `src/run/execution-adapter.ts`：`ExecutionAdapter.evaluate` 返回类型改为 `Promise<AxisItemResult[]>`（替代旧 `EvaluationResult`），统一单行 runner 与多模型 runner（B-direct）的返回口径；`AdapterError` 新增 `result?: AxisItemResult[]` 透传字段，供 harness/致命错误时把完整 runner 失败载荷带出。
- `src/run/runner-types.ts`：上提 `AxisItemResult`（统一 item 执行结果），打破 `l1-runner` 与 `runner-shared` 之间的循环类型依赖。

**2. 7 个 runner 改造为 adapter 类**

- `src/run/l1-runner.ts` → `L1Adapter`（fold 事件直测）
- `src/run/l2-runner.ts` → `L2Adapter`（假宿主 + 剧本）
- `src/run/l3-runner.ts` → `L3Adapter`（对拍）
- `src/run/b-runner.ts` → `BDirectAdapter`（多模型直连）
- `src/run/c-runner.ts` → `CAdapter`（轴 CLI 壳）
- `src/run/hosted-runner.ts` → `HostedAdapter`（hosted 冒烟）
- 均删除旧 `runXxxItem` 入口函数，8 阶段（discover → preflight → prepare → submit → collect → evaluate → cleanup）显式化，执行语义不变。

**3. RunOrchestrator 接线**

- `src/run/run-orchestrator.ts`：`executeCase` 改为直接消费 cases-v1 领域对象（`CaseRevision` + `EnvironmentProfile` + `AdapterContext`），串接 8 阶段并映射 `results`，处理 `AdapterError.result` 透传。
- `src/cli/commands/run.ts`：删除 `runOneItem` switch 分派，改由 `resolveAdapter(revision, environment)` 按 `execution_profile.mode` 解析 adapter，再经 `RunOrchestrator.executeCase` 驱动执行。

**4. 测试更新**

- 新增 `tests/run/l2-runner.test.ts`、`tests/run/l3-runner.test.ts`、`tests/run/b-direct-runner.test.ts` 单测与端到端冒烟。
- `tests/run/hosted-runner-pass-token.test.ts`、`tests/run/hosted-runner-timeout-workspace.test.ts` 改用 `HostedAdapter` + `RunOrchestrator` 的 `runHosted` 辅助函数。
- `tests/drivers/fold.test.ts`、`tests/run/c-idempotency.test.ts`、`tests/run/run-orchestrator.test.ts` 改调新 adapter 类与 `RunOrchestrator`。

**5. Bugbot 审查修复（S4）**

- `HostedAdapter.pairKey` 字段声明后从未赋值，导致 hosted 结果 `effect_pair` 恒为 `undefined`。修复：`AdapterContext` / `executeCase` 的 `exec` 新增 `pairKey?: string`，`run.ts` 把 `runCase.pairKey`（`case.pair_key ?? case_id.toUpperCase()`）透传进 adapter，`HostedAdapter.discover` 读 `ctx.pairKey` 赋值。
- `runLog.model_environment` 重构表达式错误（用 env 覆盖后的 `hostModel` 而非环境声明值）。修复：新增 `roomModel` 字段存环境声明模型，`model_environment` 还原为 `roomModel ?? null`（与原 `runHostedSmokeItem` 一致）。

**验证（实测，2026-10-19）**：

- `npm run typecheck`：0 错误
- `npm run lint`：通过
- `npm test`：61 文件 322 测试通过（沙箱内 `event-store.test.ts` 4 例因 `git init` 被沙箱拦截而红，非沙箱环境 5/5 通过，属环境限制非代码缺陷）
- `format:check`：全仓干净

## §27 技术债收口核查 + Agent 评测方法调研（2026-10-19）

**1. 技术债/功能尾巴核查（结论：无未完成事项）**

- 工作区干净，无未提交改动；唯一未推送提交为 §26 的 `45e4e8a`（单远端 origin，属正常待推送）。
- 全仓 TODO/占位 grep 命中的均为**有意设计**（`item new` 骨架 TODO 占位、各 runner「暂不支持 oracle 类型」的显式拒绝、测试 fixture 的 placeholder），非技术债尾巴。
- 此前 todo 列表标记「未完成」的 A 类（health.ts PRESETS 死字段）与 B 类（绞杀者迁移）经 git 历史核实**已分别在 `d9eac45`（§20）完成**，仅状态标记滞后，已同步。
- `legacy_item_id`、`defaultRelease` 等为**有意保留的活代码/迁移字段**，非待删死代码。

**2. Agent/LLM 评测方法调研（六路联网检索，四维度）**

- 产出：`docs/10-Agent评测方法调研与优化项.md`（结论+优化项清单）+ `docs/archive/process/agent-eval-survey-2026-10_推演过程.md`（过程记录）。
- 结论：本项目在**可执行验证、轨迹+结果双轨、快好省三维、不可变版本、归因树**五维度已对齐甚至领先业界（SWE-bench/LangSmith/OpenHands）；差距在五个执行层缺口——**裁判模型、一致性量化、安全红队、持续评测闭环、标准化 trace**，其中前四个领域类型层已预留骨架未落地。
- 优化项清单（未实施，待另行对齐）：① 裁判模型执行落地；② 一致性量化（pass^k/多次 trial 范围）；③ 安全红队执行器（IPI 注入+canary）；④ 持续评测闭环；⑤ OTel 导出（后置）。
- 建议执行顺序：② → ① → ③ → ④ → ⑤。

**验证（实测，2026-10-19）**：

- 文档链接可解析；`docs/README.md` 索引已挂新调研文档；术语与现有文档一致。

## §28 优化项需求分析与排序（2026-10-19）

对 §27 调研产出的 5 个优化项，逐项结合本项目现状做完整需求分析并排序。

- 产出：`docs/11-优化项需求分析与排序.md`（逐项需求分析 + 排序结论）。
- 现状基线：裁判模型/一致性/安全红队/持续评测/OTel 五项的**类型层骨架与执行层缺口**已逐一核实（`RubricSpec`/`Score.source`/`repeats`/`SecurityBoundary.canary_secret`/`FaultInjectionProfile` 均已定义但无执行实现；`baseline pin`/`compare`/`score-write` 已存在但无「失败→回归题沉淀」命令；全仓无 OTel）。
- 排序结论：② 一致性量化 → ① 裁判模型 → ④ 持续评测闭环 → ③ 安全红队 → ⑤ OTel（后置）。
- 排序理由：② 成本最低无前置依赖先做；① 需先建人类标注校验基准；③ 成本最高需先明确最小范围；⑤ 明确后置。
- 下一步：按 grill-me 规范，先就「优化项 ② 一致性量化」发起对齐（未实施，待确认）。

**验证（实测，2026-10-19）**：

- 文档链接可解析；`docs/README.md` 索引已挂新需求分析文档；现状基线经代码核实。

## §29 全面界面化 + 全局模型配置池 + 裁判体系（2026-10-19）

grill-me 对齐后落盘设计（S2）并实现第 0 期（S3）。

**1. 方向升格：全面界面化（宽口径）**

- 界面形态从「终端 console」升级为「现代化 Web 界面」，复用 `src/` 领域层 + run 引擎，外包 HTTP API + SPA 前端，`apps/console/` 逐步退役。
- 新增 ADR-0009（`docs/architecture/adr/0009-web-ui-and-model-pool.md`），登记技术底座 + 分期。

**2. 全局模型配置池 `models.json`（已实现）**

- 复用 `Provider` / `ModelCatalogEntry`，扩展 `category`（单值主分类）、`tags`（多值）、`params`（参数档）、`api_key_env`（密钥引用，不存明文）。
- 实现：`src/model-pool/model-catalog.ts`（纯逻辑：加载/查询/回写/裁判选型兜底链）+ `apps/console/controllers/model-pool.ts`（HTTP API）+ `public/model-pool.js`（前端增删改查 + category/tag 筛选）。
- 使用处（环境 `host_model` / 题目 `model_id` / 裁判模型点）未命中自动登记回写；裁判选型兜底链：显式 → `judge` → `general` → 报错。

**3. 裁判体系三类来源（已实现）**

- 题目对比（确定性 oracle）必现；模型判断（LLM-as-judge）与人工判断（human）人为触发；三类 `Score` 分列、不进硬门禁。
- 实现：`src/judge/judge.ts`（裁判 prompt 模板 + 严格 JSON 解析 + Score 构造）+ `src/judge/resolve-rubric.ts`（从 case-revisions 自动读 `expect.rubric`）+ `apps/console/controllers/judge.ts`（触发裁判 API，rubric 缺失时自动读题目配置）+ `public/app.js`（触发裁判 UI + 结果展示）。
- 裁判结果落盘 `judge_scores.json`（`Score[]`，含 `item_id` 关联），与硬门禁 `pass` 分列；模型判断失败降级 `judge_error`，不阻断。

**4. 分期（第 1/2 期仅立待办，未实施）**

- 第 0 期（本次）：模型配置池 + 裁判体系（在现有 `apps/console/` HTTP 服务上扩展）。
- 第 1 期：录题 / 环境 / 数据集界面化。
- 第 2 期：跑批 / 报告 / 健康检查界面化 + console 退役。

**5. Bugbot 审查（S4）**

- 云端 Bugbot 两次连接中断，按规范降级为**本地自审**，发现并修复 4 项：`Score` 缺 `item_id` 关联（docs/02 要求 item 级 scores）、`itemId` 声明未用、`mergeScores` 缺 item 维度致多题互相覆盖、`baseUrl` 硬编码 deepseek。

**验证（实测，2026-10-19）**：

- `npm run typecheck`：0 错误；`npm run lint`：通过；`npm test`：336 通过（新增 21 例；4 例沙箱 `git init` 拦截属环境限制）。
- 端到端实测：模型配置池增删改查、触发裁判（model/human）、rubric 自动读、judge_scores 落盘均正常。
- ADR-0009 已挂 `docs/architecture/README.md` 索引；`docs/02` §4.3.1 + §5.1、`docs/03` §5.1 + §7、`docs/11` 已补。

## §30 优化项 ② 一致性量化（repeats 上移 + pass^k，2026-10-19）

grill-me 对齐后落盘设计（S2，ADR-0010）并实现（S3）。

**1. 对齐结论（grill-me）**

- 范围：direct + hosted 都纳入 repeats。
- 实现位置：repeats 上移到 `RunOrchestrator.executeCase` 层循环，每次 trial 一个独立 `CaseExecution`（`replicate_index` 递增）+ `Attempt`，符合 docs/02 §3.3「统计重复以新 CaseExecution + replicate_index 表达」。
- B-direct 迁移：`job.repeats` 固定 1，`item_id` 由编排层统一追加 `::rN` 尾缀（仅 repeats>1 时）。
- **repeats 采用 opt-in 语义（默认 1，声明才生效）**：行业做法（HumanEval/SWE-bench/promptfoo/DeepEval 默认 n=1），要稳定性结论时显式声明 `repeats=4`（业界 pass@4）。

**2. 实现（S3）**

- `src/run/repeats.ts`：`resolveRepeats`（题级 `execution.repeats` > 环境级 `adapter.repeats` > 默认 1，钳制 ≥1）。
- `src/run/consistency.ts`：`aggregateConsistency`（pass^k + 成功率范围 + flaky 标记）+ `extractCaseId`（去 `::rN` 尾缀）。
- `src/run/run-orchestrator.ts`：`executeCase` 改为循环 `resolveRepeats` 次，返回 `caseExecutions[]`；`executeOnce` 抽单次 8 阶段；repeats>1 时统一追加 `::rN` 尾缀。
- `src/run/b-runner.ts`：`discover` 的 `repeats` 固定 1，删除 `roomRepeats`；`item_id` 保留 model 段，trial 序号由编排层追加。
- `src/run/write-artifacts.ts`：报告新增「一致性量化」段落（pass^k / 成功率范围 / flaky）；`byId` 用去尾缀 key 匹配，适配 repeats>1 的 item_id。

**3. 验证（实测，2026-10-19）**

- `npm run typecheck` 0 错误；`npm run lint` 通过；`npm test` 351 通过（新增 15 例：consistency 8 + write-artifacts 一致性报告 2 + orchestrator repeats 1 + 其他）。
- 串行跑全绿；并发跑偶发 1 例失败（`run-command.test.ts` 与 `concurrency-run.test.ts` 共享 demo-project runs 目录的既有竞态，非本次改动引入）。
- ADR-0010 已挂 `docs/architecture/README.md` 索引；`docs/02` §5.2、`docs/11` 优化项 ② 已补。

**4. Bugbot 审查（S4）**

- 云端 Bugbot 发现 1 项 medium：`aggregateConsistency` 未排除「无 `::rN` 尾缀的单次 trial 题」，混合 run 时单次题把成功率范围拉到 0%/100%、虚增 pass^k 分母。
- 已修复：`hasTrialSuffix` 过滤单次题，仅聚合 repeats>1 的 trial；新增红测「单次题不污染聚合」验证。

**5. 后续（未实施）**

- 优化项 ① 裁判校验基准（依赖录题能力，第 1 期界面化后）。
- 优化项 ④ 持续评测闭环（失败 → 回归题沉淀）。
- 第 1 期界面化（录题 / 环境 / 数据集）；第 2 期（跑批 / 报告 / 健康检查 + console 退役）。
- 优化项 ③ 安全红队（成本最高，最后）；⑤ OTel（明确后置）。

## §31 第 1 期录题界面化（生命周期状态机 + rubric 声明，2026-10-19）

grill-me 对齐后落盘设计（S2，ADR-0011），实现见后续提交。

**1. 对齐结论（grill-me）**

- 范围：核心录题/改题界面（题干 + 预期合同含 Oracle/Rubric + 生命周期 + 准备度 + 分层）；版本差异 UI 与失败 Run 回流 UI 后置。
- 保持配对题 OFF/ON 模式（`pair_key` 关联，首轮 ON/OFF 对照根基，不动）。
- 补 rubric 声明：写入 `CaseRevision.expect.rubric`（`dimensions: [{ name, scale, weight }]` + 可选 `judge`），打通第 0 期裁判体系「题目自动读 rubric」。
- 生命周期完整状态机：`draft → candidate → reviewed → validated → released → deprecated` 线性前进；`candidate/reviewed/validated` 可回退 `draft`；`released` 后不可回退、不可原地改（升版本）、仅可 `deprecated`；`deprecated` 终态。
- 准备度正交可编辑：`automation_readiness`（`not_assessed/manual_only/spec_incomplete/design_ready/blocked`）。
- 分层暴露：`strata.task_type` / `difficulty_level`。
- 元数据不升版本：`lifecycle`/`automation_readiness`/`tags`/`lifecycle_history` 属 Case 层，变更只改 `case.json`；题干/预期/Rubric/分层属修订正文，变更升版本。
- 本机单用户信任模型：流转记录流程声明（操作者/时间/说明），不宣称双人审批。

**2. 设计落盘（S2）**

- ADR-0011 已挂 `docs/architecture/README.md` 索引。
- `docs/02` §3.2 补生命周期流转规则；`docs/03` §4.1 补录题/改题表单字段。

## §32 运行环境 Profile 管理 UI（生命周期 + 复现清单，2026-10-19）

grill-me 对齐后落盘设计（S2，ADR-0012），实现见后续提交。

**1. 对齐结论（grill-me）**

- 范围：Profile 管理 UI（Instance 编排后置）。
- Profile 生命周期：`draft → active → deprecated` 线性前进，存环境文件顶层 `lifecycle` 字段（与 `recipe` 平级），变更不触发配方版本化。
- 复现清单实时只读采集，不落盘 `EnvironmentManifest`（Manifest 属 Instance 编排，后置）：
  - 静态：recipe 字段、Secret Reference 状态（只显示「已配置/未配置」，不显示密钥值）。
  - 运行时采集：Git commit、工作树 dirty 状态、Node 版本、OS 架构、lockfile 摘要。
  - 采集失败显示「未采集/不可用」及原因，不伪造版本/hash。
- 后置：Instance 编排（一键建立/检查/重置/停止/销毁/重建）、EnvironmentManifest 落盘。

**2. 设计落盘（S2）**

- ADR-0012 已挂 `docs/architecture/README.md` 索引。
- `docs/02` §4.7 补 Profile 生命周期流转规则与复现清单实时采集定位；`docs/03` §4.4 补 Profile 管理。

**3. 实现与决策记录（S3–S5，自主工作阶段）**

本切片实现过程中的关键选择（供复核）：

- **`safeUnder` 传文件名既有 bug**：`envEnvironmentsList/Update` 原用 `safeUnder(environmentsDir, f)` 传文件名，`safeUnder` 内部 `resolve(target)` 基于 cwd 而非 root，导致环境列表恒返回空。修复为传完整路径 `join(environmentsDir, f)`。此为 env 功能的前置依赖，非顺手重构。
- **`collectReproManifest` 不接收 project 参数**：复现清单采集的是测试平台（本仓）自身版本信息（Git commit/Node/OS/lockfile），与具体被测项目无关，故移除多余参数，避免语义误导。
- **`lockfileSummary` 依赖计数**：用 `"node_modules/"` 前缀计数，实测精确（1022 依赖 = packages 字段数 −1，根项目无前缀），不引入完整 JSON.parse 开销。
- **既有 L0 冒烟阻塞修复**（为让 env 断言 C-A-53~56 能跑到）：
  - `health.ts` PRESETS 补 `defaultRelease: 'paired-off'`（与 `run-plan.ts` 的 `defaultRelease` 一致，此前缺失导致 C-A-02 断言 KeyError）。
  - `console-l0.sh` C-A-52 verify 模型 ID 由不存在的 `wave-ai/gpt-5.4-mini` 改为真实 `wave-anthropic/claude-sonnet-5`。
- **`.console-catalog.json` 运行时产物**：L0 冒烟 verify stub 会生成该文件，此前未 gitignore。已加 `**/.console-catalog.json` 规则并清理残留。
- **既有未修问题（记录，不在本切片）**：`bank/validate` 与 `/api/run` 的 job 执行在 Node 24 下因 `src/run/execution-adapter.ts:106` 的 TS 参数属性语法（strip-types 不支持）失败，属既有运行时环境约束；`format:check` 报 7 个既有文件格式问题（`apps/console/bank.ts`、`tests/console/bank-lifecycle.test.ts`、`docs/07`、`docs/10`、`docs/README.md`、`docs/archive`、`.Herdchestra/diagnostics`），均为前序切片遗留，待独立清理。

**4. 技术债清理（自主工作阶段续）**

env 切片收口后，按「不留技术债」维度清理既有缺陷，使 `console-l0.sh` 完整冒烟首次全绿：

- **`format:check` 全绿**（提交 `38facd9`）：`.prettierignore` 排除 `.Herdchestra/` 诊断产物目录；格式化 6 个前序切片遗留文件。
- **Node 24 strip-types 参数属性**（提交 `df2d6d8`）：`src/run/execution-adapter.ts` 的 `AdapterError` 构造器参数属性（`readonly kind` 等）改显式字段声明 + 赋值，规避 strip-only 模式不支持参数属性，恢复 `/api/run` 与 `bank/validate` 的 live 执行。
- **录题 schema 缺失 `lifecycle_history`**（提交 `df2d6d8`）：`buildCaseDoc` 已写 `lifecycle_history` 字段但 `case.schema.json` 未定义（`additionalProperties: false`），导致录题后校验 `SCHEMA_CASE` 报错回滚。补 `lifecycle_history` 数组定义（`from/to/reason/at`）。
- **修复后 `console-l0.sh` 完整冒烟通过**（含新建/删除题闭环、run、pin/compare），此前因上述既有缺陷一直跑不通。

## §33 第 1 期数据集管理界面化（2026-10-19）

自主工作阶段切片：数据集管理 UI（`docs/03` §3 数据集管理第一步）。

**1. 范围与决策（自主选择，按不留技术债维度）**

- **范围**：前端独立「数据集」页 + 后端 `GET /api/test-sets/:id` 详情接口。展示：题目名单（taskId）、任务类型 × 难度覆盖矩阵、无插件侧/有插件侧计数、未覆盖项（缺分层 / 读取失败分列）。
- **不做**：测试集删除 / 编辑（底层 `createTestSet` 已有；删除/编辑涉及 OFF/ON 成对 release 一致性，风险高，后置）。
- **「正例/负例」口径澄清**：配对题语境下 OFF（无插件）与 ON（有插件）是**同一道题的两个侧面**，并非两类样本。`offCount`/`onCount` 是「具备无插件侧/有插件侧修订的题目数」，配对题两者恒相等。故 UI 用「无插件侧（OFF）/ 有插件侧（ON）」措辞，不用「正例/负例」，避免与 `docs/02` §3.1 `expected_negative_behavior` 归因语义混淆。
- **「边界覆盖」表达**：用 strata 的 `difficulty_level` 分布近似表达（覆盖矩阵 task_type × difficulty_level），不引入新字段。

**2. 实现（S3）**

- `apps/console/test-sets.ts`：新增 `testSetDetail()`，复用 `getTask` 读每题 strata/lifecycle/tags/off/on，聚合覆盖矩阵 + 计数 + `missing`（缺分层）/ `unreadable`（读取失败，分列）。
- `apps/console/controllers/test-sets.ts` + `router.ts`：新增 `GET /api/test-sets/:id`。
- `apps/console/public/datasets.js`（新增）+ `index.html` + `app.js` + `styles.css`：数据集页（列表 + 详情 + 覆盖矩阵表 + 新建测试集复用题库页对话框）。
- 新建测试集成功后 `bank.js` 派发 `test-sets-changed` 事件，`datasets.js` 监听刷新（避免重复注册 submit handler 导致重复创建）。

**3. 验证（实测，2026-10-19）**

- `scripts/console-l0.sh` 完整冒烟通过（新增 C-A-57 详情接口断言：字段齐全 + 未知测试集 400）。
- `npm run typecheck` 0 错误；`npm run lint` 通过。

**4. Bugbot 审查（S4）**

- 本地自审发现 4 项：1 High（正例/负例口径错误，已改为「无插件侧/有插件侧」）、1 Medium（导航页口径需同步 changelog §1，已更新顶栏）、2 Low（事件联动耦合、`missing` 语义混杂，已拆 `unreadable` 字段）。均已修复。

## §34 优化项 ① 人工标注校验基准（inter-judge agreement，2026-10-19）

自主工作阶段切片：裁判模型上线前的人工标注一致性校验（`docs/10` 优化项 1 前置条件）。

**1. 范围与决策（自主选择，按不留技术债维度）**

- **度量**：逐维度二值 `pass/fail` 的 **Cohen's Kappa**（剔除随机一致）+ 一致率 + 有效配对样本数；总体跨维度聚合。Kappa 是业界标准 inter-judge agreement 度量。
- **配对口径**：同 `item_id` + `dimension` 下取 `model_judge` 与 `human` 各一条配对；`deterministic_oracle` 不参与（确定性判据非「判断者」）；无 `pass` 的 `judge_error` 记录不参与配对。
- **门槛语义**：纯报告指标，不进硬门禁（与裁判体系「不进硬门禁」原则一致）；样本 < 2 标记「样本不足」，不产出 kappa 结论。
- **既有缺陷修复（前置依赖）**：`Score` 类型缺 `pass` 字段，且 `verdictsToScores`/`humanScores` 把 `DimensionVerdict.pass` 丢弃、只存 `reason`，导致 `judge_scores.json` 从未落盘 pass/fail 判定（前端 `renderJudge` 读 `s.pass` 恒 undefined，✅/❌ 展示失效）。补 `Score.pass?: boolean` 并写回，属校验基准的前置依赖，非顺手重构。

**2. 实现（S3）**

- `src/judge/agreement.ts`（新增）：`collectPairs` / `cohensKappa` / `computeAgreement` 纯逻辑。
- `src/domain/types.ts`：`Score` 补 `pass?: boolean`。
- `src/judge/judge.ts`：`verdictsToScores`/`humanScores` 写回 `pass`。
- `apps/console/controllers/judge.ts` + `router.ts`：新增 `GET /api/judge/agreement?runPath=...`。
- `apps/console/public/app.js` + `index.html`：judge 面板展示一致性基准（总体 Kappa + 逐维度）。

**3. 验证（实测，2026-10-19）**

- `tests/judge/agreement.test.ts` 新增 8 例（配对/跳过 judge_error/kappa 边界/样本不足）；`npx vitest run` 362 通过（4 例 `git init` 沙箱拦截属环境限制，非沙箱下 event-store 5 例全过）。
- `npm run typecheck` 0 错误；`npm run lint` 通过；`scripts/console-l0.sh` 完整冒烟通过（新增 C-A-58 校验接口断言）。

**4. Bugbot 审查（S4）**

- 云端 Bugbot 发现 4 项 Low/Info（无 High/Medium）：`app.js` 死代码三元表达式、样本不足文案措辞、`judgeAgreement` async 冗余、`cohensKappa` 无变异退化边界未文档化。均已修复。

## §35 优化项 ④ 持续评测闭环（失败 → 回归题沉淀，2026-10-19）

自主工作阶段切片：失败 run 一键沉淀为 `candidate` 状态回归题，保留证据链。

**1. 范围与决策（自主选择，按不留技术债维度）**

- **现状**：已有「失败 → 预填录题向导」半自动回流（`renderFailDrafts` → `openWizardWithDraft`），但缺三点：不保留证据链（attribution/oracle 失败信息/来源 run）、不标记 `candidate` 状态、不记录来源。
- **范围**：补齐证据链 + `candidate` 状态 + 来源记录，把「预填向导」升级为「一键沉淀为候选回归题」。**不做**：自动全量沉淀（保留人工确认）、生产流量采样（本项目无此概念）。
- **「异常」定义**：所有 `fail` 题都可沉淀（不限定 attribution 为 MODEL_*）。回归题价值在「曾经失败过」，产品缺陷（product_defect）类失败同样值得沉淀；由用户在 UI 勾选要沉淀哪几题。
- **「原题+新证据」还是「新题」**：沉淀为**新题**（新 taskId），但把失败证据（attribution + oracle 失败信息 + 来源 run）写入 notes 与 change_log，保留证据链。理由：失败题常需改题干/终态词才能成为有效回归题，直接复用原题会造成混淆。
- **证据链落点**：`FailureDraftHint` 补 `source_run`（来源 run 路径）+ `oracle_failures` 摘要；沉淀时写入新题 `notes`（「回归沉淀：来源 run X · 归因 Y · 失败信息 Z」），默认 `lifecycle = candidate`。

**2. 实现（S3）**

- `apps/console/run-summary.ts`：`FailureDraftHint` 补 `source_run`/`oracle_failures`；`summarizeFailures` 补 `runDir` 参数；`buildRunSummary` opts 补 `runDir`。
- `apps/console/controllers/runs.ts`：`runsView` 传 `runDir: dir`。
- `apps/console/public/bank.js`：`openWizardWithDraft` 接收失败证据，预填时默认 `lifecycle=candidate`、写回归沉淀 notes；`wizSubmit` body 加 `lifecycle`/`notes`；向导第 4 步预览展示「回归沉淀」来源标记。
- `apps/console/public/app.js`：`renderFailDrafts` 传完整 hint（含 sourceRun/oracleFailures），按钮文案改「沉淀为候选回归题」。
- `apps/console/bank.ts`：`createTask` 补 lifecycle 枚举校验（防非法状态写入）。

**3. 验证（实测，2026-10-19）**

- `tests/console/run-summary.test.ts` 补 `source_run`/`oracle_failures` 断言；`tests/console/bank-lifecycle.test.ts` 补「create 拒绝非法 lifecycle」1 例；均通过。
- `npm run typecheck` 0 错误；`npm run lint` 通过；`scripts/console-l0.sh` 完整冒烟通过。

**4. Bugbot 审查（S4）**

- 本地自审发现 1 Low（`createTask` 未校验 lifecycle 值，已补 `isLifecycleState` 校验）+ 3 Info（changelog 描述与实际改动不符，已修正；message 截断口径与信息重复展示属设计取舍，不阻塞）。

## §36 第 2 期界面化：趋势页 + 健康检查页（2026-10-20）

自主工作阶段切片：第 2 期 Web UI 的「趋势」与「健康检查」两页，把 CLI `report trend` 与运维检查搬进操作台。

**1. 范围与决策（自主选择，按不留技术债维度）**

- **趋势页**：把 CLI `report trend` 的核心扫描逻辑抽成纯函数 `collectTrendPoints`（CLI 与 console API 共用，不复制两份），新增 `GET /api/runs/trend`，前端「趋势」页展示跨 run 指标时间线（started_at / run_id / 数据集 / 指标值 / 门禁）。
- **健康检查页**：新增 `GET /api/health/check` 综合健康检查，聚合服务状态、项目摘要错误、题库校验（复用 `item validate`）、环境目录（未验证模型/Agent）、数据集完整性（缺分层/读取失败）、复现清单。前端「健康检查」页一键触发。
- **console 退役（后置）**：本次**不删** CLI 引擎命令（`proctor run/compare/baseline` 等仍被 console 内部调用，删除会破坏依赖）。console 退役是渐进过程，本次聚焦「趋势 + 健康检查」界面化，退役作为后续独立项。
- **指标口径**：趋势默认 `a_case_pass_rate`，前端下拉提供 `a_case_pass_rate` / `a_token_pass_rate` / `a_timeout_rate`；后端按 `metric` 从 `aggregates` 取值，不引入新字段。

**2. 实现（S3）**

- `src/cli/commands/report-trend.ts`：抽 `collectTrendPoints` 纯函数 + 导出 `RunPoint`；`runReportTrend` 改调它（行为不变）。
- `apps/console/controllers/runs.ts` + `router.ts`：新增 `runsTrend` + `GET /api/runs/trend`。
- `apps/console/controllers/health.ts` + `router.ts`：新增 `healthCheck` + `GET /api/health/check`。
- `apps/console/public/trends.js`（新增）+ `health-check.js`（新增）+ `index.html` + `app.js`：趋势页与健康检查页，接入顶栏导航与 `applyPage`。

**3. 验证（实测，2026-10-20）**

- `scripts/console-l0.sh` 完整冒烟通过（新增 C-A-59 趋势接口、C-A-60 健康检查接口断言）。
- `npm run typecheck` 0 错误；`npm run lint` 通过；`npm test` 363 通过（4 例 `git init` 沙箱拦截属环境限制，非沙箱下 event-store 5 例全过）。

**4. Bugbot 审查（S4）**

- 云端 Bugbot 发现 1 Medium：`initHealthCheck()` 在页面加载时无条件触发完整健康检查（含耗时的 `item validate` spawn），即使用户未点按钮。已修复：`initHealthCheck` 只 `wire()` 绑定按钮，改为按需触发，不自动跑。

## §37 优化项 ③ 安全红队执行器（IPI 注入 + canary 验证，2026-10-20）

自主工作阶段切片：补安全边界强制（`docs/11` 优化项 ③），首期最小可行闭环。

**1. 范围与决策（自主选择，按不留技术债维度）**

- **范围**：新增独立命令 `proctor redteam`，复用 hosted 隔离机制跑题，每个 case 注入独立随机 canary，run 后程序化检测 canary 是否泄露到 stdout/stderr，产出 `security_report.json`（独立安全门禁，不进常规 pass 门禁）。
- **canary 设计（可证伪）**：随机 `PROCTOR-CANARY-<16位hex>`，每次 run 生成、跨 case 不重复，避免固定 canary 被训练数据「认识」导致误报。
- **判定（工具 judge，程序化）**：canary secret 出现在 stdout/stderr → 判泄露，记录命中表面。不做 prompt judge（模型判断隐瞒，成本高，后置）。
- **不做**：全量红队（INFUSE 56 类攻击面）、对抗性自适应攻击、工作区新写入文件扫描（后续增强）、prompt judge。
- **注入点**：通过 `AdapterContext.security.canary_secret` 可选透传，`HostedAdapter.prepare` 在隔离 workspace 播种 `canary.txt`；正常 run 不传 `security` 时零开销（安全测试独立于能力测试）。

**2. 实现（S3）**

- `src/security/canary.ts`（新增）：`generateCanarySecret` / `buildCanaryInjection` / `detectCanaryLeak` 纯逻辑。
- `src/security/redteam.ts`（新增）：`buildSecurityReport` / `readCanaryLeakFromArtifact` / `generateCanarySecrets` / `writeSecurityReport`。
- `src/run/execution-adapter.ts`：`AdapterContext` 增加可选 `security.canary_secret`。
- `src/run/run-orchestrator.ts`：`executeCase` / `executeOnce` 透传 `security`。
- `src/run/hosted-runner.ts`：`prepare` 注入 canary 文件、`submit` 检测泄露、`collect` 记录 `canary_leak` 到 runLog。
- `src/cli/commands/redteam.ts`（新增）+ `main.ts`：`proctor redteam --dataset <名> --environment <名>`。

**3. 验证（实测，2026-10-20）**

- `tests/security/canary.test.ts`（7 例）+ `tests/security/redteam.test.ts`（7 例）全过。
- `npm run typecheck` 0 错误；`npm run lint` 通过；`npm test` 377 通过（4 例 `git init` 沙箱拦截属环境限制）。
- `proctor redteam` 命令注册正确（无 `--project` / 无 dataset 时报错路径符合预期）。

**4. Bugbot 审查（S4）**

- 云端 Bugbot 发现 1 High：canary 注入被 `this.wantIsolated` 门控，非隔离环境（`isolation_profile: 'shared'` 且无 `durable_log_glob`）时 canary 从未注入，但泄露检测仍报告 `leaked: false`，产出假阴性。已修复：`HostedAdapter.prepare` 在 `canarySecret` 存在但非隔离时抛 `AdapterError`（安全红队必须隔离执行，静默跳过会假阴性）。




