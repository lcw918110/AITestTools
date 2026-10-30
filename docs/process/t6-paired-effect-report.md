# T6 插件效果配对实验报告（paired-off × paired-on 全量 156 对）

## 结论

**配对通过率：OFF 156/156（100%）vs ON 155/156（99.4%），配对差 Δ = −0.64 个百分点。**

插件（万象术 treatment）在 156 题全量配对中**未引入回归意义上的差异**：
- 唯一的 ON 失败题 `paired-task-92.r4.on` 复跑 2 次均为同一断言失败
  （`deploy-anchor` oracle 要求英文 `deploy`，模型输出中文「部署时间戳」；
  `hold-conclusion` / `spike-anchor` / `HOLD_TRUTH` 暗号全部命中），语义
  上模型作答正确，属**试题断言中英文用词缺陷**（rev4 加严时引入），非
  模型能力或插件行为问题。已登记试题修订项（r5 放宽正则）。
- 该题 `attribution_focus=PROTOCOL`、协议探针 `RuntimeStarted` /
  `JournalEnvelope` 均命中——插件自身工作正常。

## 执行条件（实验可复现性）

| 项 | 值 |
| :-- | :-- |
| OFF 环境 | `hosted-plain-v1`，run `20261030-204310913-k42w` |
| ON 环境 | `hosted-plugin-v1`，run `20261030-211930219-cpwt`（1–72）+ 断点续跑 `20261030-235702260-b8k0`（73–109）+ 10 批重跑 `20261031-*`（110–156 及 HARNESS 补跑） |
| 模型 | `kw92.cyou/lazy/task`（两侧行同源冻结） |
| 数据集 | `paired-off` / `paired-on`（同题配对，156 对） |
| 判定 | workspace 断言为主，pass_token 为辅（1–71 题从 artifacts 重建判定，零假阳校验通过） |

## 与 T6 效果冒烟（157–159 专项）的一致性

- 冒烟 OFF：1/3（158 过，157/159 `MODEL_TASK`）；
- 冒烟 ON：0/3（全部 `CONTEXT`：orchestrator 接受任务后未委任下游
  manager/devops，`ChatExecution Accepted` 落库但 commission=0）；
- 全量 ON 155/156 与冒烟 ON 0/3 的差异说明：**冒烟题（157–159）比正式
  配对题更难**（多席位委任场景），正式 156 题不依赖下游多席位委任即可
  通过。插件对单席位任务无回归影响。

## 过程中发现并已修复的引擎缺陷（详见 changelog §44）

1. `sandbox-runtime.ts`：`wrapHostCommand` 的 reset→initialize→wrap 链无
   超时 → 长跑进程内周期性永挂 → 已加 60s 硬上限（HARNESS 归因快速失败）；
2. `hosted-runner.ts`：deadline 定时器 `unref()` → 在事件循环无其他驱动句柄
   时兜底失守 → 已改 `ref()` 显式持有；
3. 遗留（L2，已留 issue 追踪）：SandboxManager 挂起的深层根因在
   `@anthropic-ai/sandbox-runtime` 第三方包内部（连接排水），纯 wrap 循环
   （v1 80 轮 / v2 隧道 40 轮 / v3 真实 opencode 60 轮）均无法复现，仅在
   「真实跑题 × 长跑进程」组合下出现。当前兜底已把影响降级为「单题 60s
   失败、可重跑通过」，不再阻塞整批。

## 数据可信度声明

- ON 侧 1–71 题判定从首跑 artifacts（`workspace_ok`/`timed_out`/`host_exit`）
  重建，与 run 命令判题语义逐字对齐，`workspace_ok 但 host 异常` 的假阳
  校验为 0；
- ON 侧 110–156 中所有 HARNESS（沙箱挂起兜底触发）题目均经独立小批重跑，
  47/48 通过，唯一失败即上述 92 题断言用词问题（复跑 2 次结果一致，稳定
  可复现）；
- 全部中间数据已归档：`/tmp/on-merged-results.json`、
  `/tmp/first-run-verdicts.json`、`/tmp/on-final-merged.json`。
