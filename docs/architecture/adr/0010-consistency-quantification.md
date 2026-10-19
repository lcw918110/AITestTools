# ADR-0010：一致性量化（repeats 上移 + pass^k / 成功率范围）

| 字段   | 值                   |
| :----- | :------------------- |
| 状态   | **已采纳**           |
| 日期   | 2026-10-19           |
| 决策人 | grill-me 对齐（§30） |

## 背景

模型题（direct / hosted）结果有随机性，单次 run 的 pass/fail 是点估计，无法判断「换个 seed 是否还过」，选型结论不稳。

现状：

- `repeats` 字段已定义（`CaseRevision.execution.repeats`、`AdapterSpec.repeats`、`ExperimentPlan.repeat_strategy.repeats`）。
- B-direct 在 `promptfoo.ts` 内部展开 repeats（`for repeat <= job.repeats`），`item_id` 带 `::rN` 后缀；fixture 模式下同一 fixture 复用 N 次，无真实随机差异。
- Hosted 无 repeats（`submit` 单次 spawn，`evaluate` 返回单条结果）。
- 聚合层 `aggregateItemMetrics` 只做 mean/sum，无 pass^k / 成功率范围。
- `a_flaky_rerun_delta` 已定义但单次 run 记 0，注释明说「不等于已证明无 flaky」。

## 决策

1. **repeats 上移到编排层**：`RunOrchestrator.executeCase` 对同一 `CaseRevision` 循环调 N 次 adapter，每次 trial 一个独立 `CaseExecution` + `Attempt`，`replicate_index` 从 0 到 N-1。
   - 符合 `docs/02` §3.3「统计重复以新 `CaseExecution` + `replicate_index` 表达；技术重试只创建 Attempt」。
   - direct / hosted 统一口径，不再有 adapter 内部展开与编排层展开两套语义。

2. **B-direct 迁移**：`promptfoo.ts` 的 `job.repeats` 固定 1，`item_id` 不再带 `::rN` 后缀；repeats 由编排层驱动。fixture 模式下每次 trial 读同一 fixture（结果一致，pass^k 恒等于 pass@1），live 模式下才产生真实差异。

3. **repeats 采用 opt-in 语义（默认 1，声明才生效）**：
   - 优先级：题级 `execution.repeats` > 环境级 `adapter.repeats` > 默认 1。
   - 行业做法（HumanEval / SWE-bench / promptfoo / DeepEval）默认 `n=1`，要稳定性结论时显式声明采样次数；避免无谓成本翻倍。
   - 需要一致性结论时显式声明 `repeats=4`（业界 pass@4 常用值）或 3~10。

4. **聚合层新增一致性指标（纯报告，不进硬门禁）**：
   - `a_pass_k`：k 次全过的题数 / 题数（k = 实际 repeats）。
   - `a_success_rate_min` / `a_success_rate_max`：每题的 trial 成功率范围（min~max）。
   - 与 `a_flaky_rerun_delta`（跨 run 重跑差异）语义区分：repeats 是同一 run 内多次 trial，flaky delta 是跨 run 的重跑差异。

## 后果

- 正面：选型结论从点估计升级为范围估计，flaky 题可被识别；direct/hosted 口径统一。
- 负面：声明 repeats 后真宿主跑 N 次，token/时间成本 N 倍；编排层需处理 N 次 Attempt 的归并与报告。
- 不做：不改 L1/L2/L3 行为/事件题（确定性，无需 repeats）；不把 pass^k 变硬门禁；不改万象术业务逻辑；不默认多次采样（opt-in）。

## 相关

- `docs/02-总体架构与领域设计.md` §3.3、§5.2、§5.4
- `docs/11-优化项需求分析与排序.md` 优化项 ②
- `docs/process/01-changelog.md` §30
