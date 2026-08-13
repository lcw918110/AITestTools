# 过程变更摘要（合并自过时日记）

本文件合并并取代以下**纯推进日记**（已删除，避免与 DoD / 运维专文重复）：

- ~~17-overnight-handoff-2026-07-26~~
- ~~23-autonomous-run-2026-07-26~~
- ~~27-autonomous-continue-2026-07-27~~

权威细节仍以保留专文为准：`16` 解冻、`20` DoD、`00` 终审；按日日记见 [`../archive/process/`](../archive/process/)。

---

## 2026-07-25 → 07-26

| 项                 | 结果                                |
| :----------------- | :---------------------------------- |
| L2 review 闭环     | nudge + review；`smoke-A` 绿        |
| contract verify    | FakeHost + 真宿主二进制字符串 probe |
| B-direct promptfoo | fixture 矩阵绿；ADR-0007            |
| hosted smoke       | 无有效会话诚实 FAIL；有模型可 PASS  |
| Phase 1 DoD        | 收口（见 `20`）                     |

## 2026-07-26 → 07-27

| 项                                   | 结果                                                           |
| :----------------------------------- | :------------------------------------------------------------- |
| ST-\* → L1                           | `st-import-L1`（后扩至含 ST-14）                               |
| L3 cassette 录制 / 回放              | 最小面绿；`PROCTOR_RECORD_CASSETTE`                            |
| Node                                 | **24.18**（`.node-version`）                                   |
| paperset gates / concurrency / trend | 落地                                                           |
| C 轴 oracle                          | `workspace_assert` / `tool_result_equals` / `tool_side_effect` |
| hosted NDJSON 竞态                   | 短等轮询修复                                                   |
| 完整 Plugin 假宿主                   | **明确不做**                                                   |

## 2026-07-27（运维 / ST）

| 项             | 结果                                       |
| :------------- | :----------------------------------------- |
| Git 开源       | https://github.com/lcw918110/AITestTools   |
| npm 官方发布   | **暂缓**                                   |
| ST-14          | L1 Strict                                  |
| ST-06/09/12/16 | C 真 git → `st-real-git`                   |
| 题库本地副本   | `examples/wanxiangshu-papers/`（ADR-0008） |

## 2026-07-27（产品评测最小面）

| 项                                     | 结果                                                           |
| :------------------------------------- | :------------------------------------------------------------- |
| `examples/product-eval`                | paired-off/on、eval-agent                                      |
| demo `eval-model` / `eval-agent`       | 测模型 / 测 Agent paperset                                     |
| `compare` effect + `effect_compare.md` | 通过率差、指标差、参考分差                                     |
| `proctor score write`                  | 参考分（不进硬门禁）                                           |
| `npm run eval:paired` / `eval:model`   | 默认离线；直播 `PROCTOR_EVAL_LIVE=1`                           |
| hosted 无 plugin 不再误挂 SUT_ROOT     | `resolvePluginPath` 修复                                       |
| 文档合并精简                           | Phase提纲合一；测试手册合一；PRD→`docs/requirements/01-prd.md` |

## 2026-07-27（自主推进 · 待办收口）

| 项                      | 结果                                    |
| :---------------------- | :-------------------------------------- |
| 待办清单                | [`05-backlog.md`](05-backlog.md)        |
| 离线 verify             | 91 tests 绿                             |
| 直播配对（3 题）        | **6/6** 绿；compare Δpass=0             |
| `hosted_pass_token`     | 可配多词终态（修 TASK-02 yes）          |
| product-eval TASK-02/03 | paired 各 3 题；DONE 审查场景           |
| 参考分 + 分差报表       | score write×6；Δ=+1.33/5                |
| `eval:score-demo`       | `scripts/demo-score-paired.sh`          |
| CI                      | `.github/workflows/ci.yml`              |
| sync:papers             | 已同步 wanxiangshu-papers；TASK-03 对齐 |

## 2026-07-27（效果优化 · 5 对题 + 配对报表）

| 项                       | 结果                                             |
| :----------------------- | :----------------------------------------------- |
| product-eval             | **5 对**（ok / yes / DONE / PLAN_OK / CONTINUE） |
| `resolveHostedPrompt`    | 修：读 `stimulus.ref` 正文，不再误用 notes       |
| compare `paired_effects` | `effect_compare.md` 出 off↔on 分差表             |
| 量表                     | `rubrics/effect-v1.json`                         |
| 直播配对                 | **10/10** 绿；参考分 base=2.6 cand=4.2 Δ=+1.6    |

## 2026-07-27（1+3 目录 + 测模型同题）

| 项                | 结果                                                                |
| :---------------- | :------------------------------------------------------------------ |
| product-eval 布局 | `bank/` + `rooms/` + `papersets/` + `protocol/`                     |
| 测模型            | `eval-model` 与配对共用 `*-OFF` 五题                                |
| npm               | `eval:model`→product-eval；`eval:model:demo-schema` 保留 CI fixture |

## 2026-07-27（评测操作台 MVP）

| 项          | 结果                                                          |
| :---------- | :------------------------------------------------------------ |
| 需求 / 设计 | `02-console-prd` · `08-console-outline`（含题库编辑器阶段 B） |
| 实现        | `apps/console/`：选型 · 一键跑 · 结果页                       |
| 启动        | `npm run console` → http://127.0.0.1:8787                     |
| 题库编辑器  | 本轮仅文档立项；实现见下一节                                  |

## 2026-07-27（题库编辑器 + 测试文档）

| 项            | 结果                                         |
| :------------ | :------------------------------------------- |
| 需求/设计审核 | 修订 `02-console-prd` · `08-console-outline` |
| 测试文档      | 新增 `docs/test/03-console-ops.md`           |
| 实现          | `/api/bank/*` + 题库 UI；新建挂卷            |
| 自测          | L0 API 全绿                                  |

## 2026-07-27（Phase2 Coordinator + Plugin 假宿主重开）

| 项               | 结果                                                    |
| :--------------- | :------------------------------------------------------ |
| 口径             | 原「不做」→ stubbed-ctx MVP / Coordinator HTTP 最小面   |
| Coordinator HTTP | `st-coordinator-e2e` · `shells/st-coordinator-http.mjs` |
| Plugin 假宿主    | `smoke-A-L2-plugin` · stubbed ctx in `l2-runner`        |
| npm              | `smoke:coordinator` · `smoke:plugin-fakehost`           |

## 2026-07-27（朝完善：门禁 / 删除 / effect_pair）

| 项            | 结果                              |
| :------------ | :-------------------------------- |
| console:smoke | `scripts/console-l0.sh` + CI      |
| bank 单测     | `tests/console/bank.test.ts`      |
| 删除任务      | `DELETE /api/bank/tasks/:id` + UI |
| effect_pair   | hosted → results.ndjson           |

## 2026-07-27（题库严格版 · 需求 03 / 设计 09）

| 项   | 结果                                                                 |
| :--- | :------------------------------------------------------------------- |
| UI   | 录题 4 步向导 + 改题页拆分；人话标签；删除手打题号                   |
| API  | 强制升版 + `changeName`；终态词⊂题干；录题失败回滚；`passToken` 双接 |
| 测试 | `bank.test.ts` + `console:smoke` 覆盖 C-B-30～34                     |
| 文档 | 03/09 升为已验收；`docs/test/03-console-ops.md` 加严                 |

## 2026-07-27（主线收口 + TASK-06/07）

| 项           | 结果                                                               |
| :----------- | :----------------------------------------------------------------- |
| backlog      | 主线 1–19 已尽；下一波 N1–N8（文档/扩题/门禁/CI/L1/直播/npm/密钥） |
| 设计 08      | 去掉可选 `bumpRev`；PUT 强制升版 + 必填 `changeName`（对齐 03/09） |
| product-eval | **7 对**：+`RISK_OK`（风险门）+`HANDOFF`（交接）；挂全 papersets   |
| 离线         | validate / `eval:paired`（跳过 LIVE）；**未**宣称直播验收          |

## 2026-07-27（N4 + TASK-08/09）

| 项           | 结果                                                                    |
| :----------- | :---------------------------------------------------------------------- |
| CI           | 显式 `npm run validate:product-eval`（无密钥/无 SUT_ROOT）              |
| product-eval | **9 对**：+`SCOPE_OK`（砍范围）+`TRIAGE_OK`（事故初判）；挂全 papersets |
| 离线         | validate / `npm test`；**未**宣称直播验收                               |

## 2026-07-27（N2/N3 续 · TASK-10/11）

| 项           | 结果                                                                         |
| :----------- | :--------------------------------------------------------------------------- |
| product-eval | **11 对**：+`CLARIFY_OK`（澄清前置）+`VERIFY_OK`（改后验证）；挂全 papersets |
| bank 单测    | 题号单数字拒录文案；删除缺 confirmId 文案 + 材料未删                         |
| 离线         | validate / `npm test`；**未**宣称直播验收                                    |

## 2026-07-27（市场调研建议 · 批次 A/B 自主）

| 项            | 结果                                                                    |
| :------------ | :---------------------------------------------------------------------- |
| N6 LIVE 口径  | [06](06-paired-live-11-effect-2026-07-27.md)；Δpass=0；**待人确认结论** |
| 结果页        | 归因占比 / 稳定性 / 配对摘要 / 参考分 / 信息性指标表面化                |
| baseline      | console `pin` + `compare` API/UI；L0 + `run-summary` 单测               |
| report.md     | 显式 flaky/归因；有则写信息性指标（不进硬门禁）                         |
| 失败回流      | 结果页「预填录题向导」最小版                                            |
| 确定性 oracle | **未改**（产品题无清晰新扩展点；沿用 `hosted_pass_token`）              |

## 2026-07-27（公开题库导入 · TASK-12～16）

| 项           | 结果                                                                                               |
| :----------- | :------------------------------------------------------------------------------------------------- |
| product-eval | **16 对**：+`SAFE_REFUSE` / `APPROVE_GATE` / `CITE_OK` / `INJECT_HOLD` / `REPRO_MIN`               |
| 来源         | Promptfoo MIT、Inspect MIT、IFEval Apache-2.0；注入/复现为启发自研（见各 `SOURCE.md`）             |
| 跳过         | AgentBench 样例正文未稳定取到；EvalScope 知识榜与定位不符；SWE-bench / CyberSecEval **原题不搬运** |
| 离线         | `validate:product-eval` / `npm test`；**未**宣称直播验收                                           |

## 2026-07-28（ROUND1 入库 · TASK-17～29）

| 项           | 结果                                                                                                                                  |
| :----------- | :------------------------------------------------------------------------------------------------------------------------------------ |
| product-eval | **29 对**：+13（`TOOL_SKIP` / 双通道注入 / `FAIL2PASS` / `CONFIRM_DEL` / `VERIFY_INTEGRITY` + F 日常 7 题）                           |
| 对齐         | [07 覆盖分析](07-bank-coverage-analysis.md) **全部 P0**；并入 collector-F；裁定 [REVIEW-ROUND1](bank-ingest-staging/REVIEW-ROUND1.md) |
| 编码向       | ≥半数（评审/带测/commit/破坏性/触达/举证/缺测拒 done 等）                                                                             |
| 离线         | `validate:product-eval` / `npm test`；**未**宣称直播验收；**未** commit                                                               |

## 2026-07-28（题库覆盖分析）

| 项       | 结果                                                                                                       |
| :------- | :--------------------------------------------------------------------------------------------------------- |
| 覆盖分析 | [07-bank-coverage-analysis.md](07-bank-coverage-analysis.md)（正式 16 对 + staging A–E；待 F/ROUND1 补节） |
| 用途     | 手动录题 / 后续入库优先级；**未**改正式 items                                                              |

## 2026-07-28（ROUND2 入库 · TASK-30～40）

| 项           | 结果                                                                                      |
| :----------- | :---------------------------------------------------------------------------------------- |
| product-eval | 本轮 +11（F 余项 8 + P1 env/prompt/沙箱读 3）；当时累计 **40** 对                         |
| 对齐         | collector-F **清零**；07 §7.5；裁定 [REVIEW-ROUND2](bank-ingest-staging/REVIEW-ROUND2.md) |
| 编码向       | 8/11；安全边界受控 3 题                                                                   |
| 离线         | `validate:product-eval` / `npm test`；**未**宣称直播验收；**未** commit                   |
| 后续         | ROUND3 已续扩至 50 对（见 [REVIEW-ROUND3](bank-ingest-staging/REVIEW-ROUND3.md)）         |

## 2026-07-28（2h 题库采集流水线收束 · ROUND18）

| 项           | 结果                                                                                                                    |
| :----------- | :---------------------------------------------------------------------------------------------------------------------- |
| product-eval | **156** 对（+5：`HC_DEPTH` / `DEP_SLA` / `FOUR_EYE` / `RB_BOX` / `CUST_TMPL`）                                          |
| 裁定         | [REVIEW-ROUND18](bank-ingest-staging/REVIEW-ROUND18.md)；正式收束 [PIPELINE-DONE](bank-ingest-staging/PIPELINE-DONE.md) |
| loop         | 20min `AGENT_LOOP_TICK_bank_ingest` **已停**                                                                            |
| 离线         | `validate:product-eval` / `npm test`；**未** LIVE；**未** commit                                                        |
| 人工后续     | LIVE 复跑 / L1 冒烟 / 密钥轮换                                                                                          |

## 2026-08-13（万象术 0.8 接入面止血）

| 项          | 结果                                                                      |
| :---------- | :------------------------------------------------------------------------ |
| Plugin 路径 | 优先 `dist/Infrastructure/OpenCode/Plugin/Plugin.js`；旧 Hosts 路径仅回退 |
| 导出        | `{ id, server }` 适配（L2 / opencode-plugin-entry）                       |
| 门禁        | `smoke:wanxiangshu` 仅 C git；coordinator 退出 2；ndjson 探针不当绿       |
| 被测仓构建  | Fable 整仓未绿（未改万象术）；Plugin.js 文件在但 import 不完整            |
| 随后        | L1 已按 `foldEnvelope` 重接（见下节）                                     |

## 2026-08-13（L1 foldEnvelope 重接）

| 项          | 结果                                                                                         |
| :---------- | :------------------------------------------------------------------------------------------- |
| fold-bridge | `Journal.foldEnvelope`；刺激 `RuntimeStarted` / journal Envelope JSON                        |
| 试卷        | `smoke-A-L1` 两题；`npm run smoke:wanxiangshu:l1` 真跑（需 `SUT_ROOT` + `dist/Journal/Fold.js`） |
| 旧 ST       | Review/Nudge/Squad 入口调用即失败；`st-import-L1` 未全改                                     |
| 未做        | LIVE、扩题、阶段 C                                                                           |

## 2026-08-13（EventStore 归因 + 自主优化）

| 项            | 结果                                                                                         |
| :------------ | :------------------------------------------------------------------------------------------- |
| 耐久只读      | `refs/wanxiang/store` + `events/<shard>/<id>.jsonl`；Kind=`JournalEnvelope`/`RuntimeStarted` |
| hosted-runner | 工作区 git init；artifact `event-store.json`；ndjson 不当挂载                                |
| 真 hosted     | **阻塞**：Plugin import 缺 `PromptDispatcherSend.js`                                         |
| L1            | `smoke-A-L1` 增线格式第 3 题                                                                 |
| 日志          | [08-autonomous-optimize-2026-08-13.md](08-autonomous-optimize-2026-08-13.md)                 |
| 未做          | LIVE、改万象术 F#、提交 156/console                                                          |
