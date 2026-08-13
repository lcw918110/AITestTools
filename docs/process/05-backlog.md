# 05 · 待办与推进记录

| 字段   | 值                                     |
| :----- | :------------------------------------- |
| 状态   | **现行**（主线 1–19 已尽）             |
| 日期   | 2026-08-13（接入面止血 + L1 重接）     |
| 阅读序 | 过程第 **5** 篇（日常看 01-changelog） |

本文列出**产品评测最小面收口之后**的待办，按推荐执行顺序排列，并记录关键过程。

---

## 1. 主线收口（1–19 · 已尽）

| 序  | 待办                                                      | 优先级 | 状态                                  |
| :-- | :-------------------------------------------------------- | :----- | :------------------------------------ |
| 1   | 离线回归：`npm run verify`                                | P0     | ✅ 绿                                 |
| 2   | 离线配对：`npm run eval:paired`（无 `PROCTOR_EVAL_LIVE`） | P0     | ✅ 绿                                 |
| 3   | 直播配对：`SUT_ROOT` + `PROCTOR_EVAL_LIVE=1` + compare    | P0     | ✅ 10/10 绿（历史验收；扩题后需复跑） |
| 4   | GitHub Actions CI（`verify` + `smoke:offline`）           | P1     | ✅ 已加                               |
| 5   | 充实 `product-eval`（≥5 配对任务）                        | P1     | ✅ TASK-01～05；续扩见下一波          |
| 6   | `hosted_pass_token`（多词终态判定）                       | P1     | ✅ 已落地                             |
| 7   | 过程记录（本页 + `01-changelog`）                         | P1     | ✅                                    |
| 8   | npm 公开发布                                              | P2     | **暂缓**（需人决策）                  |
| 9   | 密钥轮换                                                  | P2     | **需你操作**                          |
| 10  | Phase 2 真 Coordinator HTTP e2e（最小面）                 | P3     | ✅ `st-coordinator-e2e`（1 题）       |
| 10b | ST 矩阵 L1+C 闭合（优先 L1；git 走 C）                    | P3     | ✅ 01–16 由 L1+C 覆盖                 |
| 11  | 完整 Plugin 假宿主（stubbed-ctx MVP）                     | P2     | ✅ `smoke-A-L2-plugin`；非 MCP 全真   |
| 12  | sync:papers + 效果题充实                                  | P2     | ✅ 初版 5 对；续扩见下一波            |
| 13  | 参考分 + 分差 / 配对报表                                  | P2     | ✅ Δ=+1.6；paired_effects             |
| 14  | hosted 读 `stimulus.ref` 正文                             | P1     | ✅ resolveHostedPrompt                |
| 15  | product-eval 1+3 目录 + 测模型同题对齐                    | P1     | ✅ bank/rooms/papersets/protocol      |
| 16  | 操作台 MVP：三实验选型 + 一键跑 + 结果页                  | P1     | ✅ `apps/console` · `npm run console` |
| 17  | 题库编辑器（阶段 B）                                      | P1     | ✅ 初版 API + UI；L0 自测绿           |
| 17b | 题库严格版（需求 03 / 设计 09）                           | P1     | ✅ 向导/强制升版/回滚/confirmId       |
| 18  | console L0 进 CI + bank 单测 + 删除任务闭环               | P1     | ✅ `console:smoke` / DELETE / tests   |
| 19  | results 落盘 `effect_pair`                                | P2     | ✅ hosted + write-artifacts           |

**结论**：主线 1–19 **已尽**（除 **8 npm 暂缓**、**9 密钥需人**）。后续只做「下一波」，**不开**阶段 C / rooms UI / MCP 全真 / Coordinator 全矩阵。

---

## 2. 下一波清单

| 序  | 项                                 | 依赖                           | 状态                                                                                                                                                            | 可自主？                 |
| :-- | :--------------------------------- | :----------------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------- | :----------------------- |
| N1  | 文档卫生                           | 无                             | ✅ 本轮：08 去可选 bumpRev；本页收口；运维路径改 bank/                                                                                                          | 是                       |
| N2  | 效果题扩容 TASK-06+                | 题库严格规则                   | ✅ 至 **156** 对（ROUND1～18；2h 流水线收束见 [PIPELINE-DONE](bank-ingest-staging/PIPELINE-DONE.md) / [REVIEW-ROUND18](bank-ingest-staging/REVIEW-ROUND18.md)） | 是（真工具 Call 轴仍缺） |
| N3  | 门禁加固（bank 边界单测等）        | `tests/console/bank.test.ts`   | ✅ 补题号单数字拒录 + 删除缺 confirmId 文案；C-B-30～34 基线                                                                                                    | 是（可再扩）             |
| N4  | CI 无密钥扩挂                      | `.github/workflows/ci.yml`     | ✅ 显式挂 `validate:product-eval`（无密钥/无 SUT_ROOT）                                                                                                         | 是                       |
| N5  | L1 人工冒烟（操作台 UI）           | 浏览器 + `npm run console`     | ⏳ 手册见 `docs/test/03` L1                                                                                                                                     | **需人**                 |
| N6  | 直播回归（扩题后）                 | `.env` + OpenCode + `SUT_ROOT` | ✅ 已跑 LIVE（11/11↔11/11，Δpass=0）；**结论待人确认** · [06](06-paired-live-11-effect-2026-07-27.md)                                                           | 跑通待人确认结论         |
| N7  | npm 公开发布                       | 产品决策                       | **暂缓**                                                                                                                                                        | 否                       |
| N8  | 密钥轮换                           | 运维                           | **需你操作**                                                                                                                                                    | 否                       |
| N9  | console 结果可读（归因/配对/对照） | artifacts 字段                 | ✅ summary + pin/compare UI；L0/单测                                                                                                                            | 是                       |
| N10 | 信息性指标 / flaky 表面化          | metrics / report.md            | ✅ 有则展示；report 显式稳定性节                                                                                                                                | 是                       |
| N11 | 失败 run→录题草稿                  | 结果页                         | ✅ 预填向导最小版                                                                                                                                               | 是                       |
| N12 | 确定性判定加深                     | 产品题 oracle 扩展点           | ⏭ 无清晰新扩展点（沿用 hosted_pass_token）                                                                                                                      | 是（本轮跳过）           |
| N13 | 万象术 0.8 接入面止血              | 被测仓布局/导出                | ✅ 路径+导出适配；coordinator/ndjson 标失效                                                                                                                     | 是                       |
| N14 | L1 按 foldEnvelope 重接            | N13 + 万象术 dist/Journal      | ✅ fold-bridge + smoke-A-L1（RuntimeStarted×2）；旧 ST 入口调用即失败                                                                                            | 是                       |

---

## 3. 关键过程记录

### 2026-08-13 · 万象术 0.8 接入面止血

**触发**：万象术自 7/27 起 1200+ commit / 升至 0.8.1；本仓 Plugin/Fold 路径过期。

| 项          | 结果                                                                                                                                                                                  |
| :---------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 被测仓构建  | `dotnet tool restore && node scripts/build.mjs`（无 `npm run build`）。Fable **整仓未绿**（F# Task/Result 类型错）；`dist/.../Plugin.js` 有文件但 **import 缺模块**。未改万象术源码。 |
| Plugin 路径 | rooms / auto 探测优先 `dist/Infrastructure/OpenCode/Plugin/Plugin.js`；旧 `build/src/Hosts/OpenCode/Plugin.js` 仅回退                                                                 |
| 导出        | L2 + `opencode-plugin-entry` 识别 `{ id: "wanxiangshu-next", server }`                                                                                                                |
| 诚实门禁    | `smoke:wanxiangshu` 只跑 C git；`smoke:coordinator` 退出 2；hosted 不再用 ndjson / `assistant_completed` 当挂载绿                                                                     |
| 未做        | L1 `foldEnvelope` 重写、LIVE、扩题、commit（当时）                                                                                                                                     |

### 2026-08-13 · L1 按 foldEnvelope 重接

**触发**：止血后 Fold 产物（`dist/Journal/Fold.js`）可独立 import；Plugin 整仓仍未绿。

| 项         | 结果                                                                                                                                                          |
| :--------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 被测仓构建 | 官方编译：`dotnet tool restore && node scripts/build.mjs`（无 `npm run build`）。Fable **整仓未绿**；`dist/Journal/{Fold,Envelope}.js` 齐全，Plugin import 仍缺依赖。未改万象术源码。 |
| fold-bridge | 只碰 Journal/Fold + Envelope + Fact + Identity；刺激 `RuntimeStarted` 或 journal 线格式 Envelope JSON                                                         |
| 试卷       | `smoke-A-L1` = `WX-A-JOURNAL-RUNTIME-01/02`；`smoke:wanxiangshu:l1` 改为真跑                                                                                  |
| 旧入口     | `foldReviewTask` 等调用即失败；`st-import-L1` 未改                                                                                                            |
| 未做       | LIVE、扩 product-eval、阶段 C / rooms UI / MCP 全真、旧 ST 全量改词                                                                                           |

---

### 2026-07-27 · 自主推进（本轮）

**触发**：用户要求列清待办、按推荐顺序自主执行并记录过程。

**环境**（本机）：

| 项              | 结果                                  |
| :-------------- | :------------------------------------ |
| Node            | v24.18.0                              |
| OpenCode        | 1.18.5                                |
| `SUT_ROOT`      | `/Users/Licw/Desktop/git/wanxiangshu` |
| Plugin 构建产物 | `build/src/Hosts/OpenCode/Plugin.js`  |
| `.env`          | 存在（未在文档中记录内容）            |

**步骤 1–2 · 离线**

```bash
npm run verify          # 91 tests 绿
npm run eval:paired     # 校验 + eval-model fixture 绿；跳过直播
```

**步骤 3 · 直播配对（首次）**

```bash
SUT_ROOT=… PROCTOR_EVAL_LIVE=1 npm run eval:paired
```

- `paired-off`：**1/2**（`TASK-02-OFF` 失败）
- 根因：hosted 硬编码判定 stdout 须含 `ok`，而 TASK-02 要求 `yes`

**步骤 4 · 修复**

- schema：`stimulus.hosted_pass_token`（可选，默认 `ok`）
- 代码：`src/run/hosted-pass-token.ts` + `hosted-runner` 使用可配置词
- 题库：`PAIRED-TASK-02` 设 `hosted_pass_token: "yes"`
- 单测：`tests/run/hosted-pass-token.test.ts`

**步骤 5 · 直播配对（修复后）**

| run        | 目录（相对 `product-eval`）    | 结果    |
| :--------- | :----------------------------- | :------ |
| paired-off | `runs/20260727-141850935-2wyi` | 2/2 绿  |
| paired-on  | `runs/20260727-141908205-hjxh` | 2/2 绿  |
| compare    | 同上 candidate 目录            | Δpass=0 |

**步骤 6 · CI**

- 新增 `.github/workflows/ci.yml`：`npm ci` → `verify` → `smoke:offline`

**步骤 7 · 题库增量（本轮）**

- sync:papers 同步万象术题库副本
- `PAIRED-TASK-03`（审查清单 DONE 场景）；paired 卷各 3 题
- `eval-agent` paperset 扩至 3 题

**步骤 8 · 参考分与分差报表**

```bash
BASE=examples/product-eval/baselines/paired-off \
CAND=examples/product-eval/runs/20260727-150102881-ahra \
npm run eval:score-demo
```

结果：`base=2.67 cand=4.0 Δ=+1.33 / 5`（示意：有插件更高）。

### 2026-07-27 · 效果题库与报表优化

**步骤 9 · 题库扩到 5 对**

| 任务 | 终态     | 场景              |
| :--- | :------- | :---------------- |
| 01   | ok       | 冒烟              |
| 02   | yes      | 多词终态          |
| 03   | DONE     | 审查清单          |
| 04   | PLAN_OK  | 结构化计划 / todo |
| 05   | CONTINUE | 卡住恢复 / nudge  |

另加：`rubrics/effect-v1.json`、`intent.effect_pair`、compare **配对效果**表。

**步骤 10 · 关键 bug：hosted 未读 prompt 文件**

- 现象：TASK-03/04/05 直播失败（模型只看到 notes 短备注，去探仓库）
- 修复：`resolveHostedPrompt` 优先读 `stimulus.ref` 考材正文
- 重跑：`paired-off` / `paired-on` **5/5 + 5/5** 绿；参考分 Δ=+1.6/5；配对表 5 行 scoreΔ

run：`runs/20260727-155929919-tuo9`（off）→ `runs/20260727-160121580-qjpg`（on）

### 2026-07-27 · 1+3 目录重组与测模型对齐

- `items/`+`materials/` → `bank/`；`rubrics/` → `protocol/rubrics/`
- 组卷：`eval-model` / `eval-model-alt` 与配对题共用 `*-OFF` 任务
- `npm run eval:model` → `examples/product-eval`；demo schema 改 `eval:model:demo-schema`

### 2026-07-27 · 评测操作台 MVP

**需求 / 设计**

- [`docs/requirements/02-console-prd.md`](../requirements/02-console-prd.md)：阶段 A MVP；阶段 B 题库编辑器
- [`docs/design/08-console-outline.md`](../design/08-console-outline.md)：预设、API、验收

**MVP 缺口 → 落地**

| 缺口    | 落地                                                     |
| :------ | :------------------------------------------------------- |
| 选型 UI | `apps/console/public` 三实验单选                         |
| 一键跑  | `POST /api/run` → spawn `proctor` / `eval:paired`        |
| 结果页  | `/api/runs` + `/api/runs/view`；metrics / effect_compare |
| 环境    | 表单 `SUT_ROOT` / live / model；预填进程 env             |

**启动**：`npm run console` → http://127.0.0.1:8787

### 2026-07-27 · 题库编辑器落地 + 文档审核

**文档**

- 审核修订：`02-console-prd`、`08-console-outline`（补 API/挂卷/验收）
- 新增测试全量：`docs/test/03-console-ops.md`

**实现**

- `apps/console/bank.ts` + `/api/bank/*`
- UI 题库区：列表 / 编辑 / 新建 / 校验

**自测**：`03` L0 用例全绿（含 TMP 新建+清理）。

### 2026-07-27 · Phase2 Coordinator + Plugin 假宿主

用户确认两项可继续。口径：

- **Coordinator**：ST 01–16 由 L1+C 覆盖；另增 **1 题** 真 HTTP（`st-coordinator-e2e`）
- **Plugin 假宿主**：重开为 **stubbed-ctx 加载真 Plugin.js**；非 MCP 全真、不替代 hosted

命令：`npm run smoke:coordinator` · `npm run smoke:plugin-fakehost`

### 2026-07-27 · 朝完善自主推进

| 项                           | 结果                                |
| :--------------------------- | :---------------------------------- |
| `npm run console:smoke`      | L0 脚本；CI 挂载                    |
| `tests/console/bank.test.ts` | create/update/delete/非法 id        |
| `DELETE /api/bank/tasks/:id` | 清 materials/items/组卷             |
| typecheck/eslint             | 纳入 `apps/console/*.ts`            |
| `effect_pair`                | hosted 结果写入 `results.ndjson`    |
| 文档索引                     | requirements/design README 状态修正 |

### 2026-07-27 · 主线收口 + 效果题 TASK-06/07

**文档**

- 本页：主线 1–19 标尽；登记「下一波」N1–N8
- [`08-console-outline`](../design/08-console-outline.md)：去掉可选 `bumpRev`，对齐需求 03 / 设计 09（强制升版 + `changeName`）

**题库**

| 任务 | 终态    | 场景                 |
| :--- | :------ | :------------------- |
| 06   | RISK_OK | 改共享配置前的风险门 |
| 07   | HANDOFF | 会话交接摘要         |

离线：`item validate --check-fixtures` + `eval:paired`（无 LIVE）。**未**宣称直播验收。

### 2026-07-27 · N4 CI 扩挂 + 效果题 TASK-08/09

**N4**

- 新增 `npm run validate:product-eval`（无密钥、无 `SUT_ROOT`）
- CI 在 `verify` 后显式一步挂该命令；**未**挂 `eval:paired` LIVE / `smoke:wanxiangshu` / coordinator 等需环境项
- `validate:examples` 改为复用该 script（verify 内仍覆盖）

**题库**

| 任务 | 终态      | 场景                               |
| :--- | :-------- | :--------------------------------- |
| 08   | SCOPE_OK  | MVP 砍范围                         |
| 09   | TRIAGE_OK | 事故初判（rollback / forward-fix） |

挂卷：`paired-off` / `paired-on` / `eval-model` / `eval-model-alt` / `eval-agent`。题库现 **9 对**。离线 validate；**未**宣称直播验收。

### 2026-07-27 · N2/N3 续：TASK-10/11 + 门禁单测

**题库**

| 任务 | 终态       | 场景         |
| :--- | :--------- | :----------- |
| 10   | CLARIFY_OK | 澄清缺失前置 |
| 11   | VERIFY_OK  | 改后最小验证 |

挂卷同上。题库现 **11 对**。

**门禁单测**

- 录题题号单数字 / 缺段 → 精确文案拒录（C-B-34）
- 删除缺 `confirmId` / 空串 → 精确文案拒删且材料仍在（C-B-33）

离线：`validate:product-eval` + `npm test`；**未**宣称直播验收。

### 2026-07-27 · N6 LIVE 11 对跑通（结论待人确认）

| 项        | 结果                                                                             |
| :-------- | :------------------------------------------------------------------------------- |
| baseline  | `20260727-222722708-fe8n` → `baselines/paired-off`（11/11）                      |
| candidate | `20260727-223021445-3yzt`（11/11）                                               |
| Δpass     | **0**；漂移全 unchanged                                                          |
| 参考分    | 本轮 candidate 未写 `scores.json`，不做效果优劣裁定                              |
| 口径文    | [06-paired-live-11-effect-2026-07-27.md](06-paired-live-11-effect-2026-07-27.md) |

N6 状态：**跑通待人确认结论**（非产品终裁）。

### 2026-07-27 · 市场调研建议顺序 · 批次 A/B/C（可自主）

| 建议项             | 落地                                                                   |
| :----------------- | :--------------------------------------------------------------------- |
| A1 效果口径        | `docs/process/06-paired-live-11-effect-2026-07-27.md`；N6→跑通待人确认 |
| A2 结果页归因/配对 | `/api/runs/view`→`summary` + `effect_structured`；UI 中文块            |
| A3 baseline 产品化 | `GET/POST /api/baselines*` · `POST /api/compare`；钉选/对照按钮        |
| B4 信息性指标      | 有则展示；report.md 有则写入（hosted 当前通常无步数/成本）             |
| B5 flaky/repeats   | report + 结果页稳定性节；口径注明单次跑 ≠ 无 flaky                     |
| B6 确定性加深      | **跳过**（无清晰新 oracle 扩展点）                                     |
| B7 失败→录题       | 「预填录题向导」                                                       |
| C8 参考分 UX       | 结果页独立块；缺 scores 时提示 score write                             |
| C9 文档同步        | backlog / changelog / 08 / 03-console-ops                              |

自测：`npm test`（111）· `console:smoke` · `validate:product-eval` · `tsc --noEmit` 绿。

**停止原因（工程优化清单）**：可自主工程项已尽。仍需人：N5 浏览器 L1、N6 结论拍板、N7/N8、以及 LIVE candidate 是否补写参考分。

### 2026-07-27 · 公开题库导入（主线 · TASK-12～16）

| 任务 | 终态         | 类型                                  | 场景             |
| :--- | :----------- | :------------------------------------ | :--------------- |
| 12   | SAFE_REFUSE  | 直接改编 · Promptfoo MIT              | 安全拒绝越权     |
| 13   | APPROVE_GATE | 直接改编 · Inspect MIT                | 危险动作审批门   |
| 14   | CITE_OK      | 直接改编（方法论）· IFEval Apache-2.0 | 可验证引用       |
| 15   | INJECT_HOLD  | 启发自研 · Inspect Evals 注入方法论   | 日志内嵌注入守住 |
| 16   | REPRO_MIN    | 启发自研 · SWE-bench 方法论           | 合成议题最小复现 |

挂卷：`paired-off` / `paired-on` / `eval-model` / `eval-model-alt` / `eval-agent`。题库现 **16 对**。离线 validate；**未**宣称直播验收。

**公开集导入 backlog（短）**

| 项                            | 说明                                                            |
| :---------------------------- | :-------------------------------------------------------------- |
| Inspect Evals 其它 agent 样例 | 在确认任务正文许可后，可再改编 1～2 对（工具取消 / 多工具边界） |
| Promptfoo 其它 MIT examples   | 仅取 purpose/场景描述；继续禁止搬运闭源/付费 redteam 产出       |
| AgentBench                    | 待稳定公开样例路径与可引用正文后再评估                          |
| EvalScope / 国内说明          | 仅当出现 **Agent 行为** 公开样例且许可清晰时再导入；不做知识榜  |

### 2026-07-28 · 题库覆盖分析（手动录题指引）

- 新增 [07-bank-coverage-analysis.md](07-bank-coverage-analysis.md)：正式库 16 对快照、覆盖热力图、近义风险、录题 checklist、P0～P2 入库队列、与 staging A–E 衔接。
- **未**改 `examples/product-eval` items；**待** `collector-F` / `REVIEW-ROUND1` 完成后再补 07 一节。
- 人工录题优先按 07 §5 P0（工具弃权、非日志注入、fail2pass、欠指定确认），勿再扩冒烟/一般风险同构题。

### 2026-07-28 · ROUND2 入库（TASK-30～40）

- 正式库本轮 +11：F 余项 8（`PR_DESC`…`DOC_SYNC`）+ P1 3（`ENV_SECRET_HOLD` / `PROMPT_HOLD` / `WS_READ_BOUND`）；累计当时 40 对。
- 裁定 [REVIEW-ROUND2](bank-ingest-staging/REVIEW-ROUND2.md)；07 §7.5 轻量补节。
- 离线 `validate:product-eval` / `npm test`；**未** LIVE、**未** commit。
- 随后 ROUND3（41～50）已消化写边界 / 白名单 / 过度拒绝等延后项，见 [REVIEW-ROUND3](bank-ingest-staging/REVIEW-ROUND3.md)。

### 2026-07-28 · 2h 采集流水线收束（ROUND18 → 156 对）

- ROUND18 +5（`HC_DEPTH`…`CUST_TMPL`）；正式库 **156** 对；裁定 [REVIEW-ROUND18](bank-ingest-staging/REVIEW-ROUND18.md)。
- `PIPELINE-DONE.md` 正式定稿；20min bank_ingest loop **已停**。
- 人工后续：LIVE 复跑、L1 冒烟、密钥；**未** commit。

---

## 4. 相关入口

- 题库覆盖分析：[07-bank-coverage-analysis.md](07-bank-coverage-analysis.md)
- 变更摘要：[01-changelog.md](01-changelog.md)
- 测万象术：[../test/01-wanxiangshu-ops.md](../test/01-wanxiangshu-ops.md)
- 审核结论（已收口）：[../archive/design/32-product-eval-audit-2026-07-27.md](../archive/design/32-product-eval-audit-2026-07-27.md)
