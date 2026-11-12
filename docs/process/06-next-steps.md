# 06 · 下一步计划

| 字段 | 值                                                                                                          |
| :--- | :---------------------------------------------------------------------------------------------------------- |
| 日期 | 2026-11-10                                                                                                  |
| 角色 | 对 changelog §3 打开任务 T4/T5/T6/T7 的下一步执行计划，不作为新的需求或设计规格                             |
| 依赖 | [过程日志 §3–§42](01-changelog.md) · [术语篇](../00-glossary.md) · [_审视/主文档.md](../../_审视/主文档.md) |

本文件是对五项原始任务中「基于需求指定下一步计划」的交付物。执行依赖关系与当前阻塞点已坐实，以下不再重述调查过程。

---

## 1. 当前状态概览

### 已完成

| 任务       | 内容                                                                        | 完成标志                                         |
| :--------- | :-------------------------------------------------------------------------- | :----------------------------------------------- |
| T1         | 测试任务：按组卷筛题 + 勾选 + 任务类型                                      | changelog §2「已落地」                           |
| T2         | 测万象术无插件 / 有插件 / 同时跑                                            | changelog §2「已落地」                           |
| T3         | 可保存多条测试任务（选题 + 配置 + 跑次历史）                                | changelog §2「已落地」                           |
| T4         | 测试任务用途字段（7 类标准枚举校验、运行时锁定、GAP-4 趋势分桶防混算）      | changelog §42 / ISSUE-0008「已落地闭环」         |
| T5         | 题库难度分层字段（`strata.difficulty_level`，录题向导 + 编辑表单 + schema） | changelog §31 / ADR-0011「已落地」               |
| T6 前段    | Grill 共识 + 题面收紧 + 全链路打通报错定位                                  | changelog §6–§10；编排链断点坐实                 |
| GAP-3      | 控制台核心页面端到端测试套件扩展（Playwright 覆盖题库/数据集/环境与模型池） | changelog §42 / `tests/browser/`                 |
| GAP-4      | 趋势多用途筛选与独立分桶（CLI `--purpose`/`--bucket` + API + 前端，禁混算） | changelog §42 / `tests/cli/report-trend.test.ts` |
| ISSUE-0008 | 用途字段与跨用途防混算独立复核（7 类用途闭环、历史未知结果诊断）            | `_审视/主文档.md`（已关闭 VERIFIED / CLOSED）    |
| ——         | 独立验证：全仓 typecheck / vitest 427+ / format / product-eval 318/318      | changelog §40–§42                                |

### 进行中 / 阻塞

| 任务 | 内容                         | 状态                                                                                                                                                  |
| :--- | :--------------------------- | :---------------------------------------------------------------------------------------------------------------------------------------------------- |
| T6   | 效果实验 157–159 OFF/ON 对照 | **阻塞**。最近一次对齐重跑的 ON 产物仍记 `MODEL_TASK`，但三题都是供应商流被打断、文件没动。按现行口径是 `CONTEXT`，不进效果结论。合回仍是万象术待办。 |
| T7   | 测试结果经济四格             | **阻塞**。依赖 T6 提供有效效果数据。                                                                                                                  |

---

## 2. 各任务前置条件与依赖

### T4（用途字段）与 GAP-4（趋势多用途分桶）

- **状态：** **已落地并复核关闭**（2026-10-24，changelog §42 / ISSUE-0008 / GAP-4）。
- **落地位置与事实凭据：**
  1. `apps/console/eval-tasks.ts`：7 类用途必选校验（`eval_comparison` / `calibration` / `regression` / `scaling` / `diagnostic` / `benchmark` / `exploration`）、提交即冻结锁定并写入运行元数据；
  2. `src/cli/commands/report-trend.ts` & `apps/console/router.ts` & `controllers/runs.ts`：实现 GAP-4 趋势多用途筛选与独立分桶（`collectTrendBuckets`），在多用途未过滤冲突时返回 400 及可用用途列表，彻底隔绝跨用途混算；
  3. `apps/console/public/index.html` & `trends.js`：提供单用途聚焦下拉与多用途分桶折线图；
  4. 自动化保护：`tests/browser/task-purpose.spec.ts`（用途必选/锁定/趋势）、`tests/cli/report-trend.test.ts`、`tests/console/runs-trend.test.ts`。ISSUE-0008 已在 `_审视/主文档.md` 正式标记关闭（VERIFIED / CLOSED）。

### T5（难度字段）

- **状态：** **已落地**（2026-10-19，commit `968905c`，ADR-0011 / changelog §31）。
- **落地位置：** `apps/console/public/index.html`（`taskStrataDifficulty` / `wizStrataDifficulty`）、`apps/console/public/bank.js`、`apps/console/bank.ts`（`assertStrata`）、`schemas/case-revision.schema.json`（`strata.difficulty_level`）。

### GAP-3（端到端测试套件扩展）

- **状态：** **已落地**（2026-10-24，changelog §42 / ISSUE-0003）。
- **落地位置与事实凭据：**
  - 新增 `tests/browser/console-core-pages.spec.ts`（600+ 行，10 个自动化用例），为题库管理（`bank.js`）、数据集管理（`datasets.js`）、运行环境与模型池（`env.js` / `model-pool.js`）补齐 Playwright 端到端断言；
  - 连同已有 `task-purpose.spec.ts` 与 `user-journeys.spec.ts`，由标准 npm 脚本 `npm run console:e2e`（`playwright test tests/browser/`）自动发现并执行，彻底终结「前端零测试」缺陷。

### T6（效果实验）

- **依赖链：** 编排链 orchestrator → manager → devops 必须接通，才能产生有效对照数据。
- **当前状态（2026-11-05 更新）：** 委派已能建立。`runs/20261105-135851245-syv0` 的 ON 侧 EventStore 出现 4 个 `ManagerJobCreated` + `WorktreeCreated` + `TerminalOutputCaptured`，全程无 `RejectedDirty`。此前「`commission` 恒返回 `placement-failed`」的表象由两个本仓缺陷叠加造成，均已修复（`$schema` 脏写、插件依赖装不上，见 changelog §54）。
- **剩余阻塞：deadline 不足。** 4 个 manager 会话并行跑 LLM 流，240s 跑不完，日志末尾仍在 `llm runtime selected` / `stream`。需调大 `deadline_ms` 或减少并行会话数——**这是配置取舍，待定**。
- **配对实验前提已失效（High）：** 同一次 `syv0` 运行里，OFF 侧产物 `plugin` 字段同样是 `.../Plugin.js`，即**两侧都挂了插件**。原因是 CLI 只能传一个 `--environment`，而 `paired-delegation-smoke` 把 ON/OFF 装进同一 release。配对实验要求「只差插件一项」，现状不满足，需按侧拆分环境（OFF 用 `hosted-plain-v1`，ON 用 `hosted-plugin-v1`）。
- **本仓已就绪：** hosted 模式已支持 `event_subsequence` / `no_event` 事件类断言，`eventName` 已兼容万象术 `payload.Fact` 与 `event_type` 形状；新增 `paired-task-160` 与 `paired-delegation-smoke` 数据集，以 `ManagerJobCreated` 断言锁死委派闭环。编排链修复后可直接回归：

  ```bash
  SUT_ROOT=/Users/Licw/Desktop/git/wanxiangshu \
    npm run proctor -- run --dataset paired-delegation-smoke \
    --environment hosted-plugin-v1 --project examples/product-eval
  ```

  无需再改引擎。

### T7（经济四格）

- **依赖链：** T7 → T6 → 万象术编排链。
- **阻断原因：** 经济四格（[术语篇](../00-glossary.md#经济四格)）需有效效果对照数据支撑。T6 尚未产生有效对照（OFF 全过、ON 全挂归因为编排未启动，非题面设计问题），因此画经济四格的条件不满足。changelog §3 T7 已注明「效果差出来之前不画空图」。
- **定义归属：** 隔离的呈现层功能，底层效果数据到齐后可从本仓独立实现。

---

## 3. 推荐执行顺序

```
T4/T5 (已落地) + GAP-3/GAP-4 (已落地) → 等万象术编排链接通 (外部阻塞) → T6 → T7
```

### 第一阶段：T4 + T5 与控制台测试基建（已全部落地闭环）

- **做什么：** T4 在测试任务页新增用途字段（7 类标准枚举下拉与校验），落盘任务 JSON 与运行元数据，GAP-4 趋势分桶隔离并彻底禁绝跨用途混算，ISSUE-0008 复核关闭；T5 在题库编辑表单新增难度字段录入与展示，落盘试题；GAP-3 补齐控制台核心页面端到端测试。
- **现状：** 第一阶段任务已全部独立高质量交付，全量测试保护就绪。
- **结论：** 本仓当前已无第一阶段未决任务，主线顺延推进至第二阶段。

### 第二阶段：万象术编排链接通

- **已定案（2026-11-05，changelog §54）：** `commission` 恒失败的真实原因是 `RejectedDirty ("Worktree is dirty: opencode.json")`，根因在本仓——opencode 启动时会给缺 `$schema` 的配置补写该行，把刚提交干净的工作区弄脏。已在 `src/run/hosted-runner.ts` 播种时显式写 `$schema`。
- **端到端已证实委派建立**（`runs/20261105-144025470-oi7b`）：ON 侧 EventStore 出现 `ManagerJobCreated` + `WorktreeCreated` + `TerminalOutputCaptured`，全程 `RejectedDirty` 零次。但该次仍超时（`WorkStillActive` 致 journal 无法收敛），**闭环未完成**——没有 `commission` 返回 `{ok:true}` 的回执，也没有 manager 改完文件的证据。
  早期「OFF 侧首次通过」已作废——修复前的 `fyci` 运行里 OFF 侧本就 `pass=true`，与 `$schema` 无关。
  **注意：** 该次 OFF 侧产物 `plugin` 字段同样是 `.../Plugin.js`，说明配对实验的 OFF 侧实际也挂了插件，不能当「无插件基线」。
- **顺带修掉第二个缺陷：** 插件依赖装不上。opencode 在隔离 HOME 里解析不到 `@opencode-ai/plugin` 会后台 `npm install`，沙箱不放行 `registry.npmjs.org` 导致 403，插件加载失败（`plugin-initialization-failed`），被测插件一次都没被调用就空转到 deadline。已在 `installPluginRuntimeDeps` 里预装该依赖（从插件包根复制，网络零参与），未放行 npm registry。
- **剩余阻塞：ON 侧 journal 无法收敛（万象术侧）。** deadline 已放宽到 600s，ON 侧 179s 就放弃，不是额度问题。日志末尾 `journal semantic cut ... rejected: WorkStillActive`——manager/engineer 子会话始终活动，`SessionStartedAtBound` 出现多次但无结束事件。按本仓规则「不改万象术业务逻辑」，需上游确认子会话收敛机制。
- **配对实验前提已修复：** 此前 OFF 侧也挂了插件（CLI 只能传一个 `--environment`）。已加 `paired_environments` 映射按侧解析环境，`hosted-plugin-v1` 的 OFF 侧走 `hosted-plain-v1`。实测 `runs/20261105-144025470-oi7b`：OFF `plugin=None`、无事件流、66s PASS；ON 挂插件、有事件流。
- **上游建议（非阻塞）：** `Command.fs:1123` 的 `| Error _ ->` 建议改为透传错误文本，或按 `OrchestratorVerdict` 映射独立码。这次正是因为兜底码，才需要改上游源码重建插件才能看到 `RejectedDirty`。详见 [报障单](07-wanxiangshu-commission-bug.md)。
- **沙箱挂起：已定位到库缺陷，但未能复现触发条件（结论降级）。** `runs/20261105-141939218-tkta` 全量批跑中 117–156 连续 40 题 HARNESS，实测 117→122 每题**精确 60 秒**（14:35:52 → 14:36:53 → 14:37:53…），等于 `SANDBOX_WRAP_TIMEOUT_MS` 默认值，说明每题都在等同一个超时而非模型慢。逐层排查结论：
  1. **已排除** `reset()` 里的 close 竞争——最小复现证明 `Promise.all([muxClose, forceClose])` 下 `closeAllConnections()` 能正常救回（0.37s 完成）；真实库 + 3 条半开连接、真实 curl 经代理两种场景下 `reset()` 均在 1s 内完成。
  2. **已排除** `timer.unref()` 导致超时失效——有其它 ref 句柄时 unref 定时器照常触发（实测 501ms）。
  3. **已排除** 并发——默认 `concurrency=1`。
  4. **库内确实存在 `initializationPromise` 死锁缺陷**：`sandbox-manager.js:792` 的 `if (initializationPromise) { await initializationPromise; return; }` 会等待既有 promise，而该变量**只在 catch 分支**（:1186）和 `reset()` 尾部（:2511）清空。一旦某次 `initialize` 既不 resolve 也不 reject，promise 永久 pending，后续每题都 `await` 这个死 promise，各自等满 60s 超时。`reset()` 自救也不可行（它自身在 `await Promise.all(closePromises)`（:2504）之后才清该变量，close 挂住时一并挂）。
  5. **超时后还有「僵尸内层」**：本仓 `sandbox-runtime.ts` 的 `withTimeout` 只 reject 外层，内层 `reset→initialize→wrap` 仍在跑，稍后完成会改动全局 `SandboxManager`，与下一题的 initialize 踩踏（已用最小复现验证）。
  6. **`reset` 的真实成本已定位到「残留连接」**：在真实批跑里 hook `http/net Server.prototype.close` 后测得 `close=net(c=0):0ms, net(c=2):211ms, http(c=2):211ms, net(c=2):211ms, http(c=2):211ms`——`_connections=2` 的两组 server（`httpProxyServer`、`socksProxyServer`）各自要等 2 条残留连接结束，耗时 211–347ms；而 `_connections=0` 时是 0ms。这 2 条连接是上一题 opencode 经代理留下的，`muxProxyServer.close()` 只 destroy 自己 `openSockets` 里的 client，不覆盖这两个 server 上的连接。这也解释了为何独立探针（curl 一次即走、`conns=0`）测不出 200ms 级耗时。
     **但该缺陷尚未在真实批跑中被观测到。** 2026-11-05 19:07 起的全量 156 题批跑（`runs/20261105-190727960-wt3o`，21 分 40 秒自然结束）加装分阶段计时后跑完 156 题，三阶段净耗时全部正常：`reset` 最大 1143ms（p50 208ms，主要成本项）、`initialize` 最大 11ms、`wrapWithSandboxArgv` 最大 16ms，整链最坏 1158ms，距 60s 上限约 50 倍余量；trace 156 行与 156 题一一对应，相邻间隔最大 13.5s、无 >30s 缺口。结果 151 PASS / 5 FAIL，5 题全为 `MODEL_TASK`（oracle 语义未命中，非执行链路故障），**HARNESS 与 CONTEXT 均为 0 题**，挂起未复现。故上述只是「库代码里确实存在的缺陷」，不能断言它就是 `tkta` 那次的成因；触发条件仍未知（可能与当时机器上的残留子进程经 mux 代理留下的半开连接、或特定题目的出站模式有关）。
     库版本 0.0.81 已是最新，无法靠升级解决。防御性缓解方向：超时后在**子进程**里跑沙箱包装、或超时即重启 worker 进程，避免复用被污染的模块级状态。
  7. **`child.on('close')` 管道挂起（已修）**：`runHostedWithReap` 原用 `child.on('close')` 判定结束，而 Node 的 `close` 要求 stdio 全部关闭。opencode 是 client-server 架构，退出时留下的 server 子进程会继承 stdout/stderr pipe 写端，pipe 不关则 `close` 永不触发，只能等 deadline（180s）并被误判成超时（`CONTEXT`）——又是一个把工装问题记成环境问题的假红。最小复现：`exit` 在 6ms 触发，`close` 5 秒后仍未触发。
     **修复（双阶段结算）**：监听 `exit` 并开 500ms 宽限期；宽限期内 `close` 正常触发则用 `close` 结算（输出完整，绝大多数题走这条，与旧行为一致）；宽限期到则先置 `stdioDestroyed`、再 `destroy()` stdout/stderr 读端、`reapTree(SIGTERM)` 回收占 pipe 的孙进程，最后用 `exit` 结果结算。产物 `hosted-run.json` 新增 `stdio_destroyed` 字段。
     **独立审查修掉的连带缺陷**：①`exit` 后未清 deadline timer——若 deadline 落在 500ms 宽限期内，timer 会把 `timedOut` 置真并 `reapTree`，随后宽限期用已正常退出的退出码结算，产出 `status=0` + `timedOut=true` + `ETIMEDOUT` 的自相矛盾结果，正常完成的题被记成超时（已用真实子进程复现：`sh -c 'sleep 5 & echo HOST_DONE; exit 0'` + `timeoutMs=300`）——改为 `exit` 回调里立刻 `clearTimeout(timer)` 与 `forceKillTimer`；②宽限期只 destroy 读端不回收孙进程，每道题都会留下常驻 server 进程，批量跑卷时累积并破坏下一题的隔离假设——改为宽限期结算时先 `reapTree(SIGTERM)`，200ms 后再 `reapTree(SIGKILL)`。只发终止信号时，忽略该信号的孙进程会留下；③`graceTimer.unref()` 与本仓 `timer.ref()` 的历史教训方向相反，事件循环若恰好无其它 ref 句柄会静默失效——改为 `graceTimer.ref()`；④`runHostedWithReapForTest` 仅靠注释约束「仅供测试」——加 `NODE_ENV`/`VITEST` 断言。
     共补 7 条回归测试（EventEmitter 桩 4 条 + 真实子进程 3 条），修复前 Red 为「精确 5000ms 超时」与 `expected true to be false`，修复后全量 829 测试全绿。
  8. **宿主崩溃被误归因（已修）**：`runs/20261105-211916760-fqi8` 第 139 题 Bun `SIGTRAP` 崩溃（诱因 npm registry 403 被域名白名单拦截），`host_exit=null`、`stdout` 0 字节、`workspace_ran=false`，却被记成 `MODEL_TASK`。根因在 `evaluateHostedOracles` 的 `exit_code` 分支：`inconclusive`（被杀）只在题目声明了 `workspace_assert` 时才被尊重（`if (inconclusive && workspaceOracles)`），否则 `hostStatus === null` 直接落进 `hardExitVeto` 记 `MODEL_TASK`。统计 `examples/product-eval/case-revisions/` 全部 321 个 revision，**311 个（96.9%）没有 `workspace_assert`**，其中 284 个是 `exit_code` 单断言——宿主崩溃时全部会被误记模型失败（系统性假红）。
     **修复口径**：超时 = 本平台主动终止 → `CONTEXT`；非超时信号崩溃 / spawn 失败 = 宿主自己死或没起来 → `HARNESS`。落地为 `evaluateHostedOracles` 新增 `hostSignal` / `hostSpawnError` 入参、`resolveWorkspaceFailAttribution` 新增 `hostCrashed` 分支、新增 `isHostCrashed()`、`observeHostExit` 新增 `deadlineFired` / `host_spawn_error`。
     **两轮独立审查修掉的连带缺陷**：①`timed_out` 原先从 signal 反推，会把外部 OOM killer 的 `SIGKILL` 误判成超时，让崩溃归因对 OOM 完全失效——改为只认平台 `deadlineFired` 或 `ETIMEDOUT`；②崩溃 + 天然通过的 `workspace_assert`（如 `exists:false`）会直接假绿 PASS——改为循环外先行置 `crashVeto`，崩溃绝不产出 PASS；③`hosted-runner` 的 HARNESS 早返回会吞掉崩溃场景下的工作区失败与鉴权失败——崩溃分支提前，按已确定事实归因；④`harnessVeto` 混放 HARNESS 与 CONTEXT 导致归因取决于 oracle 书写顺序——拆成两个变量；⑤spawn 失败（`ENOENT`/`EACCES`，`status=null` 且 `signal=null`）仍被记 `MODEL_TASK`——新增 `host_spawn_error` 判据；⑥测试桩先发 `error` 再发 `close` 造成假绿（`signal` 被 settled 守卫丢弃、`deadlineFired` 主路径零覆盖）——改为 `hang` 模式真实等平台定时器 kill。
     共补 11 条回归测试，修复前 Red 报 `Expected "HARNESS" / Received "MODEL_TASK"`，修复后全量 822 测试全绿（连跑 6 轮稳定）。
  9. **配对题环境接线在 `redteam` 侧漏接（已修）**：`resolveDatasetItems` 早已把配对题按侧解析后的环境写进 `RunCaseInput.environment`，`run.ts` 也消费了，但 `src/cli/commands/redteam.ts` 仍拿命令行 `--environment` 的基准值去执行，等价于「OFF 侧也挂插件」——安全红队跑配对题时配对前提同样失效。
     **修复**：`redteam` 改为 `const caseEnv = runCase.environment ?? environment` 并传给 `executeCase`；`resolveAdapter` 去掉无用的 `_environment` 参数（它本就不消费环境，留着会让后来者误以为这里消费了）；`run.json` 与 `security_report.json` 的逐题条目都记实际环境 `environment`；`report.md` 在存在逐题环境差异时补一列「环境」，无差异时保持原表头，不改既有格式。
     **测试**：新增 `tests/cli/redteam-paired-environment.test.ts` 与 `tests/cli/run-paired-meta.test.ts`（临时工程 + mock 执行器）。修复前 Red 实测 OFF 题收到 `hosted-plugin-v1`；`run.ts` 的记账行临时改成常量后测试变红，证明不是假绿。
     **同轮独立审查修掉的连带问题**：①`docs/09` 称「加载时校验」与实际不符——实际只在 `resolveDatasetItems` 执行时校验，`proctor item validate` 不查映射目标存在性，已改为如实描述；②`docs/09` 的 `## 5.1` 层级错为二级，已改 `### 5.1`。
     **同轮独立审查记录但未改（既有行为，非本次引入）**：①`write-artifacts.ts` 在 `repeats>1` 时 `items[].pass` 只取最后一个 trial，与 `metrics.json` 的 `a_case_pass_rate` 口径不一致；②`hosted-runner.ts` 的 `installPluginRuntimeDeps` 注释称整棵复制依赖，实际只覆盖 `zod`，SUT 改用其它入口会解析失败。
     **后续已修（2026-11-11，见 changelog §55）**：第 ① 项已闭环，并连带修掉 `extractCaseId` 误剥 `::reflect`、`host_exit: null` 回落成 `0`、`report.md` 环境列查不到 B-direct 题号、`pass_token` 只取首个 trial 等同类缺陷。
     **第 ② 项复核结论（2026-11-11，含第二轮独立审查实测）：原待办前半句准确、后半句不成立。** `@opencode-ai/plugin` 的 `package.json` 声明 4 个依赖，但只有 `zod` 内嵌在包内，`@ai-sdk/provider` / `@opencode-ai/sdk` / `effect` 被 hoist 到上层 `node_modules`；复制到隔离 HOME 后只有 `zod` 能解析。**但这不构成运行时故障**：插件实际加载 `@opencode-ai/plugin/tool` 子入口，其 `dist/tool.js` 只 `import { z } from "zod"`，三个缺失包在该路径上不被 import；实测只复制包本体（含内嵌 `zod`）后 `import('@opencode-ai/plugin/tool')` 成功。故 `cpSync` 整棵复制行为正确，「SUT 改用其它入口会解析失败」属推测，已撤回。需修的是函数注释——原称「自身声明了 `@ai-sdk/provider` / `@opencode-ai/sdk` / `effect` / `zod` 等运行时依赖」，暗示四个都需要，已改为如实说明只有 `zod` 在加载路径上。
     **待人类拍板（资产配置，非代码）**：`examples/product-eval` 的 `hosted-plugin-v1` 与 `hosted-plain-v1` 除插件外还差 `host_agent`（`orchestrator` vs `fast-coder`）与 `managed_agents`（7 个管理角色 vs 20 个 fast/deep 角色），实测产物已证实两侧 agent 不同。对不要求委派的 ON 题，差值混入角色差异，配对解释力被削弱。
  10. **两侧 agent 差异的根源已查清（结论：不是配置失误，不应对齐）**：上一轮把「两侧角色不一致」当成可修的对齐问题，方向错误。读万象术插件源码 + 实跑其 identity 库后确认：
      - 插件 `src/Wanxiangshu/OpenCode/Host/ManagedAgentConfig.fs` 的 `validate` 会 `rejectLegacy config?agent`（`coder`/`inspector`/`browser`/`inquiry`/`distiller` 等 legacy 名直接 fatal），随后按 `ManagedAgent.requiredNames` 强制 `applyNamedOwnedFields` 接管 agent 条目——`opencode.json` 不是清单来源，插件自己才是。
      - 实跑 `new Identity().activeRoleLabels()` 得 `['orchestrator','manager','engineer','devops','plan']`，加 `bookkeeper` 即插件 `requiredNames`（6 个）。`legacyNames` 实测只含 `coder`/`inspector`/`browser`/`inquiry`/`distiller`/`build`/`student`/`teacher`/`meditator`/`executor` 等，`fast-coder` 写法不在其中（拆词后 fallback 解析失败）。
      - `wanxiangli/src/authority/AdmissionLaw.fs` 要求根会话 agent 与插件认知一致，否则 `InvalidExplicitAgent`。
        **结论**：ON 侧 `host_agent` / `managed_agents` 没有选择余地，是插件固有约束。OFF 侧 `fast-coder` + 20 个 fast/deep 角色是宿主自带通用池，同时服务 `eval-model`（测模型）与 `eval-agent`（测 Agent，正是要比较角色差异），**不可删**。配对不是「只差插件一行」的干净对照，而是「**有无插件及其强制接管的角色体系**」。
        **顺带修掉 ON 侧清单错误**：原 7 个 `manager/orchestrator/engineer/devops/blogger/bookkeeper/predictor` 缺插件要求的 `plan`，且 `blogger`/`predictor` 已 retired。已校正为插件的 6 个 `requiredNames`，并新增 `tests/cli/plugin-env-managed-agents.test.ts` 锁住（含 legacy 名黑名单、`fast-`/`deep-` 前缀名、`host_agent` 必须在清单内三条断言）。回归验证：恢复旧配置后 3 条断言变红。<br>经确认 `blogger`/`predictor` 未被任何题目或测试引用，`proctor item validate` 321/321 通过。
        **同一缺陷还存在于另两个插件环境（已一并修）**：测试改为扫描 `examples/*/environments` 下全部挂 `host_plugin` 的环境后暴露：
      - `examples/product-eval/environments/hosted-plugin-alt-v1.environment.json`：`fast-coder` + 20 个 `fast-`/`deep-` 名 → 改为 `orchestrator` + 插件 6 名。
      - `examples/wanxiangshu-papers/environments/hosted-wanxiangshu-v1.environment.json`：同上。
        历史产物已证实这类配置确实会失败：`runs/20260922-212305026-saug` 报 `managed-agent-config-invalid`、`runs/20260922-021713984-mos8` 报 `InvalidExplicitAgent`，均为插件环境用 `fast-*` 角色所致。两个工程 `item validate` 分别 321/321、32/32 通过。
        **文档同步**：`docs/test/01-wanxiangshu-ops.md` §2.7 原先「OFF 侧同样声明，保证只变插件」为过时表述，已改写为两侧语义分离的实证说明；`docs/09` §5.1 补「配对两侧配置差异是必然的」。
- **验证条件：** `paired-task-160` ON 侧的 `event_subsequence: ["ManagerJobCreated"]` 通过（157–159 的题面不要求委派，其 ON 修订也没有事件断言，`ManagerJobCreated` 不会出现在那三题里），且至少一道题能走通 engineer → devops 运行 → engineer 反馈的闭环。
- **2026-11-09 重跑（角色校正后）：** `runs/20261109-205719419-4v1i`，0/2。OFF 走 `hosted-plain-v1`（`plugin=None`、`agent=fast-coder`、`host_exit=0`），但工作区未含 `Math.round`，归因 `MODEL_TASK`，不能再当「无插件必过」。ON 走 `hosted-plugin-v1`（`plugin=Plugin.js`、`agent=orchestrator`、6 个管理角色），`ManagerJobCreated` / `WorktreeCreated` / `TerminalOutputCaptured` 都出现，stderr 里 manager、engineer、devops 会话都建起来了；600284ms 打满 deadline，文件未改，归因 `CONTEXT`。本次日志**没有** `WorkStillActive` 字样，断点是子会话在截止前仍在 `stream`，不是「编排链没接通」。
- **本仓已就绪：** 事件类断言、`paired-task-160` 与 `paired-delegation-smoke` 数据集已落地，可直接回归：

  ```bash
  npm run proctor -- run --dataset paired-delegation-smoke \
    --environment hosted-plugin-v1 --project examples/product-eval
  ```

### 第三阶段：T6 完成有效对照

- **条件：** 万象术编排链接通后，重跑 157–159 ON 小样本对照。
- **DoD（已定，见 changelog §6）：**
  1. OFF 必挂、ON 有机会过（剔除 CONTEXT 后）
  2. 小样本对照跑通（paired-off-effect-smoke → paired-on-effect-smoke → compare）
  3. 报告可读出 OFF 通过率 < ON
  4. 156 全量不当效果结论
- **2026-11-09 断言放宽后重跑，Δ 为负，不能宣称插件更好。** 旧断言把题目测试已通过的等价写法判失败。放宽后 OFF `runs/20261109-221233702-3oc7` 为 2/3（157、159 过；158 仍漏改 `docs/runbook.md`）。ON `runs/20261109-221441877-tgd3` 为 0/3：157 超时且文件未改（`CONTEXT`，不进效果结论），158、159 是 `MODEL_TASK`。`compare` 的 `pass_rate` 是 0.667 对 0，Δ=−0.667。DoD 要求 OFF 通过率低于 ON，本次方向相反。T7 仍不画。
- **2026-11-09 只加时重跑 157 ON，工作树改对了，播种目录没收到。** `runs/20261109-231733309-8q6x` 把 157 ON 的截止从 240s 调到 600s。结果仍是 0/1、`CONTEXT`、`materials_mutated=false`。事件里有 `ManagerJobCreated`、`WorktreeCreated`（`/tmp/claude/wanxiangshu-kzvbc2`）、`HandleWorkCompleted`。超时后播种目录已被清掉，无法核对合并；残留工作树里的 `lib/discount.mjs`、`lib/tax.mjs` 已是先减折扣、税额 `Math.round` 后相加，副本在该 run 的 `delegated-worktree-kzvbc2/`。这不能记成 PASS：监考只认播种目录，工作树改对不等于合回。
- **2026-11-10 三题截止对齐到 600 秒后重跑。** OFF `runs/20261110-001956188-qv7s` 为 2/3。ON `runs/20261110-002235952-1bxk` 产物为 0/3，三题 `host_exit=1`、`materials_mutated=false`，stderr 都有 `AI_InvalidResponseDataError`，事件里没有 `ManagerJobCreated`。产物当时记成 `MODEL_TASK`，按现行口径是供应商流被打断、材料没动，应记 `CONTEXT`，不进效果结论。该次报告未回写。不得把这次说成「根会话没委派」或「插件更差」。
- **下一步不是再改题，也不是画 T7。** `tgd3` 的 158、159 仍是根会话没文件工具、也没委派。157 加时后证明委派能改对工作树，断点改成「合回播种目录没在截止前发生」。合回是万象术待办，只登记在 [07-wanxiangshu-commission-bug.md](07-wanxiangshu-commission-bug.md)。本仓动作是清目录前把工作树副本收进产物，不改通过判定。

### 第四阶段：T7 经济四格

- **条件：** T6 产出有效效果数据（Δ 可读、归因可分类）。
- **做什么：** 在测试结果页实现弱开 vs 强关的经济四格呈现。

---

## 4. 人力介入边界

| 工作项                                    | 归属                     | 说明                                                                                                       |
| :---------------------------------------- | :----------------------- | :--------------------------------------------------------------------------------------------------------- |
| T4 用途字段                               | **已闭环落地**           | 操作台前端 + API + 任务 JSON schema + GAP-4 趋势分桶，ISSUE-0008 复核关闭                                  |
| T5 难度字段                               | **已闭环落地**           | 题库编辑表单 + 试题 schema，纯产品功能                                                                     |
| GAP-3 核心页面 E2E 测试                   | **已闭环落地**           | Playwright 覆盖题库/数据集/环境/模型池核心页面交互，终结前端零测试                                         |
| T7 经济四格                               | **本仓可独立推进** \*    | 呈现层功能，底层效果数据到齐后可独立开发                                                                   |
| T6 编排链 orchestrator → manager → devops | **工作树已改对，未合回** | `8q6x`：157 ON 600s 内建了 manager 工作树并改对折扣/税额；播种目录未改，超时 `CONTEXT`。不再说「没接通」。 |
| T6 效果对照（编排链打通后）               | **本仓可独立推进**       | 改题、跑对照、归因，复用已有 proctor 引擎路径                                                              |
| agent 中文输出                            | **万象术团队**           | `PairProgrammingThoughtTransform.fs` 改变注入指导语不影响被测 agent 自身推理语言                           |

> \* T7 标注「可独立推进」指开发能力上可以独立完成。实际开工需等待 T6 效果数据到齐。

**关键结论：** T4、T5、GAP-3、GAP-4 已全部闭环。T6 还没有可进结论的对照：`1bxk` 的 ON 三题按现行口径是 `CONTEXT`，不进 Δ。不得宣称插件更好，也不画 T7。`8q6x` 把断点收窄为：157 ON 工作树改对了，没合回播种目录。合回、错误码透传、agent 中文输出是万象术待办，只登记不改。本仓只收工作树副本，不改通过判定。

---

## 5. 已知改进项（非阻塞 backlog）

以下为 changelog 与工程备忘中记录的已知结构 / 质量改善项。它们不影响当前功能，但应在合适的时机处理。不在此排列优先级，仅记录现状。

| 项                       | 位置                                             | 描述                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | 状态          |
| :----------------------- | :----------------------------------------------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :------------ |
| server.ts handler 重构   | `apps/console/server.ts`                         | ~~单 handler 约 650 行，混路由解析 / JSON 解析 / 业务逻辑 / 响应写入，缺乏分层~~                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | ✅ 已闭环     |
| HTTP 层零测试            | `apps/console/server.ts`                         | ~~无任何 HTTP 处理层自动化测试（路由、错误码、请求体解析）~~                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | ✅ 已闭环     |
| 前端零测试               | `apps/console/public/`                           | ~~无前端组件 / 交互测试~~                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | ✅ 已闭环     |
| JSON 直写无并发保护      | `apps/console/server.ts`                         | ~~任务 JSON 与试题文件通过 `fs.writeFileSync` 直写，无锁或原子替换，并发写可能丢数据~~                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | ✅ 已闭环     |
| updateTask 多文件回滚    | `apps/console/bank.ts`                           | `updateTask` 多文件写中间失败不回滚                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | ✅ 已闭环     |
| 作业异常 fire-and-forget | `apps/console/server.ts` / `controllers/run.ts`  | ~~`void executeJob` 的 Promise rejection 无 `.catch()` 捕获，调用方收到 202 后无法感知作业失败~~                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | ✅ 已闭环     |
| 宿主输出无上限累积       | `src/run/hosted-runner.ts`                       | `stdout` / `stderr` 以字符串持续累积，解码后无封顶。**已评估，不修**：2800 个真实产物里最大 8754 字符、stderr 全为 0；实测需 800MB 输出才触发 `RangeError: Invalid string length`，余量约 2.4 万倍。加截断会引入正则扫描开销并可能截掉 oracle 依赖的文本，收益为负。                                                                                                                                                                                                                                                                                                           | ⏸ 已评估不修  |
| 测试写入共享真实产物目录 | `tests/cli/*.test.ts`、`tests/console/*.test.ts` | ~~`examples/demo-project/runs/` 累积 5,618 个真实 run 目录（239MB），`slice7-compare` / `concurrency-run` / `main.test.ts` 持续写入，并发时与趋势扫描争抢 I/O 导致 5s 超时假红。~~ **已闭环**：新增 `tests/helpers/isolated-project.ts`，用 `$TMPDIR` 临时根 + 软链真实只读资产（含 `sut/` / `cassettes`）+ 真实 `runs` 目录；四个 `tests/cli/` 文件改 `beforeAll` 建根 / `afterAll` 删除，`runs-trend` 与 `server-http` 改走 `PROCTOR_CONSOLE_PROJECT`（后者还 mock 掉 `executeJob`，不再真实 spawn 评测）。历史 5,618 个目录已清空。全量 982 通过、两个 `runs/` 增量均为 0。 | ✅ 已闭环     |
| 门禁类断言易假绿         | `tests/security/`、`tests/drivers/`              | ~~失败关闭型门禁（隔离探测、折叠归因）的测试只断言错误消息、不断言 `instanceof`；重复项夹具只把失败项放末尾，`last-wins` 实现照样通过。~~ **已闭环（§60）**：`missingProofs` 重复项改为「任一行失败即未证明」，补「失败在前/居中」用例杀死 first-wins 与 last-wins；`runFold` / `resolveFoldEntry` 全部失败分支补 `toBeInstanceOf(FoldResolveError)`。**约定**：门禁类测试必须同时断言错误类型与消息，重复项夹具需覆盖失败项在首/中/末三种位置，并用变异测试验证断言真的能捕获回归。                                                                                           | ✅ 已闭环     |
| 低覆盖模块需先判性质     | `src/contract/`、`src/security/`                 | 覆盖率低洼中，`contract/runtime-probe.ts`（4.95%）与 `security` 的探测路径需要真实 `opencode` 二进制、真实 `SandboxManager` 与平台能力，属集成探测工具，**不适合单测**（强测会引入 flaky）。真正该补的是纯逻辑分支：`run-fold.ts` / `resolve-entry.ts` 已补至 100%，`security` 的 `missingProofs` 已补。**约定**：按覆盖率找缺口前先判断「是否需要真实环境」，只补纯逻辑分支，不为数字写无价值测试。                                                                                                                                                                           | 📝 已记录约定 |

> **已闭环说明：** server.ts 拆分为 26 行装配入口 + `router.ts` + `controllers/` 8 文件；HTTP 层测试已补充（`tests/console/` 下 12 个测试含 `server-http.test.ts`）；JSON 原子写已实现（`json-io.ts` 的 `writeTextAtomic` Temp+Rename + `writeJsonAtomicCas` mtime CAS 乐观锁）；`updateTask` 快照回滚已实现（`update-task-rollback.test.ts` 覆盖）；H6 作业异常 fire-and-forget 已修复（`controllers/run.ts` 对 `executeJob` 显式 `.catch()` 落盘 job 错误状态，`server.ts` 装配入口对 `handleRequest` 用 `.catch()` 回传 500）；**前端测试（GAP-3 / ISSUE-0003）已闭环**：通过 Playwright 建立了完整端到端测试套件（`tests/browser/` 下 `console-core-pages.spec.ts`, `task-purpose.spec.ts`, `user-journeys.spec.ts`），覆盖题库、数据集、环境与模型池以及任务用途/趋势等核心页面交互与契约断言，标准脚本 `console:e2e` 自动发现与执行。

---

## 6. 文档维护约定

- 本文在 T4 / T5 / GAP-3 / GAP-4 落地或 T6 阻塞解除时更新。
- 各任务进入实现阶段后，设计细节与 Grill 共识写入对应设计文档（需求 02/03、设计 08/09），不在本文展开。
- 改进项 backlog 新增或消除时同步更新 §5。
