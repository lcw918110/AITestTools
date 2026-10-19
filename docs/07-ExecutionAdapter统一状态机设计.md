# 07 · ExecutionAdapter 统一状态机设计（阶段 4b）

> 状态：**阶段 4b 已落地（内存状态机）**；7 个 runner 已改造为 adapter，`run.ts` 已切到 RunOrchestrator（本设计 §5 落地）
> 归属：Phase 1 阶段 4b，与 Phase 2 状态机、Phase 4 功能目录一并设计
> 权威依据：`docs/02-总体架构与领域设计.md` §3.4（状态机）、§4.2（统一执行阶段）
> 类型契约：`src/domain/types.ts`（已完整，Phase 1 阶段 1 落地）

---

## 1. 目标与非目标

### 1.1 目标

把 7 个轴 runner 的**隐式生命周期**统一为显式的 8 阶段 `ExecutionAdapter` 接口，并在调度层落地 Run / CaseExecution / Attempt 三级状态机，区分 planned / resolved / observed 三值。

### 1.2 非目标（本次不做）

- 不改变 7 个 runner 的**执行语义**（oracle 判定、归因、metrics 键集合均不变）。
- 不引入持久化存储（Run/CaseExecution/Attempt 仍是内存对象 + 产物落盘，与现状一致）。
- 不改变 CLI 口径（`--dataset/--environment` 已在阶段 4a 落地）。
- 不做 Phase 4 功能目录、Phase 5 安全隔离、Phase 6 预算、Phase 7 故障注入（后续 Phase）。

---

## 2. 现状梳理（7 个 runner 生命周期差异）

| Runner               | discover/resolve            | preflight      | prepare                    | submit              | query/collect              | evaluate                                       | cleanup       |
| :------------------- | :-------------------------- | :------------- | :------------------------- | :------------------ | :------------------------- | :--------------------------------------------- | :------------ |
| L1 (fold)            | 读 stimulus 事件序列        | —              | resolveFoldEntry           | runFold             | foldState                  | event_fold / state_predicate / no_event        | —             |
| L2 (fakehost)        | 读 stimulus/script/contract | —              | 建 FakeHost + 插件         | 32 轮 turn 循环     | timeline / session         | event_subsequence / state_predicate / no_event | disposeHooks  |
| L3 (cassette)        | 读 cassette                 | —              | 建 FakeHost + 剧本/回放    | 回放 hooks          | trace.hooks / timeline     | hook-subsequence / event-subsequence           | —             |
| B-direct (promptfoo) | 读 oracles                  | —              | 建 EvalJob                 | runPromptfooAdapter | raw.rows                   | tool_trace / schema_obedience                  | —             |
| B-hosted (opencode)  | 读 probes / version         | --version 检查 | 隔离工作区 + 插件 + config | spawn opencode      | EventStore / ndjson / exit | workspace_assert / 协议探针                    | rmSync 工作区 |
| C (cli shell)        | 读 stimulus                 | —              | mkdtemp 工作区             | spawn node shell    | stdout / exit              | exit_code / workspace_assert / side_effect     | —             |

**关键结论**：

1. 「evaluate」阶段已高度统一（都走 `oracles` + `fail` / `finalizeAxisResult`）。
2. 「discover / prepare / submit / collect / cleanup」差异极大。
3. **没有任何 runner 实例化状态机实体**——`runOneItem` 是纯函数分派，直接返回 `AxisItemResult`，Run / CaseExecution / Attempt 从未被创建。

---

## 3. ExecutionAdapter 接口设计

### 3.1 接口形状（8 阶段）

```typescript
// src/run/execution-adapter.ts（新建）
export interface ExecutionAdapter {
  /** 适配器标识：唯一命名，用于产物与日志定位。 */
  readonly adapterId: string;

  /** 1. discover/resolve：解析输入，产出 resolved 值（不产生副作用）。 */
  discover(ctx: AdapterContext): Promise<DiscoveredInput>;

  /** 2. preflight：执行前预检（版本检查、密钥探测等），失败则 blocked。 */
  preflight?(ctx: AdapterContext, discovered: DiscoveredInput): Promise<PreflightResult>;

  /** 3. prepare：准备执行环境（工作区、插件、配置），产生可回滚的准备态。 */
  prepare(ctx: AdapterContext, discovered: DiscoveredInput): Promise<PreparedState>;

  /** 4. submit：提交执行（spawn / 调用 / runFold），返回句柄。 */
  submit(ctx: AdapterContext, prepared: PreparedState): Promise<SubmittedHandle>;

  /** 5. query/collect：查询状态并收集产物（可多次调用，直到终态）。 */
  collect(ctx: AdapterContext, handle: SubmittedHandle): Promise<CollectedOutput>;

  /** 6. evaluate：评估 oracle，产出 CaseExecution 终态（execution_outcome + evaluation_outcome）。 */
  evaluate(ctx: AdapterContext, collected: CollectedOutput): Promise<EvaluationResult>;

  /** 7. cleanup：清理副作用（工作区、临时 HOME、dispose），必须能报告是否完成。 */
  cleanup?(ctx: AdapterContext, prepared: PreparedState): Promise<CleanupResult>;
}
```

> 允许相邻阶段合并（02 §4.2），但必须能报告「发生了什么、失败在哪一步、是否完成清理」。

### 3.2 上下文与三值区分

```typescript
export interface AdapterContext {
  revision: CaseRevision; // 领域对象（cases-v1），直接消费
  environment: EnvironmentProfile; // 领域对象（environments/）
  projectRoot: string;
  artifactDir?: string;
  models: string[];
  sutRoot?: string;
  /** 状态机实体引用（由 RunOrchestrator 注入）。 */
  run: Run;
  caseExecution: CaseExecution;
  attempt: Attempt;
  /** 三值记录器：planned / resolved / observed。 */
  facts: ObservedFactsRecorder;
}
```

`ObservedFactsRecorder` 落地 §3.5 三段式里的 `ObservedFacts`：

```typescript
export interface ObservedFactsRecorder {
  /** 记录 resolved 值（Adapter/Provider 解析结果）。 */
  resolve(kind: string, key: string, value: unknown): void;
  /** 记录 observed 值（运行中实际观测）。 */
  observe(kind: string, key: string, value: unknown): void;
  /** 导出事实清单（落盘到 artifact）。 */
  snapshot(): ObservedFacts;
}
```

### 3.3 错误模型

统一错误类别（02 §4.2）：

```typescript
export type AdapterErrorKind =
  | 'discover_failed'
  | 'preflight_failed'
  | 'prepare_failed'
  | 'submit_failed'
  | 'collect_failed'
  | 'evaluate_failed'
  | 'cleanup_failed';

export class AdapterError extends Error {
  constructor(
    readonly kind: AdapterErrorKind,
    readonly attribution: Attribution,
    message: string,
    readonly retryable: boolean = false,
  ) {
    super(message);
  }
}
```

---

## 4. 状态机落地（RunOrchestrator）

### 4.1 编排器职责

```typescript
// src/run/run-orchestrator.ts（新建）
export class RunOrchestrator {
  /** 创建 Run（created），冻结 RunPlanSnapshot。 */
  beginRun(input: { experimentId?: string; candidateId?: string }): Run;

  /** 推进 Run：created → preflight → queued → running。 */
  transitionRun(status: RunLifecycleStatus): void; // 校验 RUN_TRANSITIONS，非法转换抛错

  /** 为单个 case-revision 创建 CaseExecution + Attempt，执行 adapter，落终态。 */
  executeCase(
    revision: CaseRevision,
    environment: EnvironmentProfile,
    adapter: ExecutionAdapter,
  ): Promise<CaseExecution>;

  /** 封存 Run 终态（completed / failed / cancelled），写 RunFinalManifest。 */
  sealRun(status: RunLifecycleStatus): RunFinalManifest;
}
```

### 4.2 状态转换约束

- Run 转换严格走 `RUN_TRANSITIONS`（types.ts 已定义），非法转换抛 `AdapterError('...', 'HARNESS')`。
- CaseExecution：`execution_outcome` 由 adapter 的 evaluate 结果映射。
- Attempt：`created → running → completed/failed`（本阶段只落地这两条，`starting` 态与 `timed_out`/`interrupted` 细分推迟到 Phase 2）。

### 4.3 映射表（EvaluationResult → 状态机终态）

> **本阶段（4b）只实现前两条**；`timed_out`/`attribution` 细分依赖 `EvaluationResult` 扩展超时字段，推迟到 Phase 2 与 runner 迁移一并落地。

| EvaluationResult       | execution_outcome  | evaluation_outcome | attempt_status |
| :--------------------- | :----------------- | :----------------- | :------------- |
| `pass=true`            | `completed`        | `pass`             | `completed`    |
| `pass=false`（含异常） | `execution_failed` | `fail`             | `failed`       |

**推迟到 Phase 2（当前未实现）**：

| 目标态                                         | 触发条件                    | 说明                               |
| :--------------------------------------------- | :-------------------------- | :--------------------------------- |
| `pass=false, 其它归因` → `completed + fail`    | evaluate 正常返回但判定失败 | 需区分「跑通未通过」vs「执行异常」 |
| `timed_out=true` → `timed_out + indeterminate` | 执行超时                    | 需 `EvaluationResult` 增加超时字段 |

---

## 5. 7 个 runner 改造清单

每个 runner 拆成 `ExecutionAdapter` 实现，**执行语义不变**，仅把隐式流程显式化：

| Runner   | 改造后文件            | discover                    | preflight | prepare          | submit              | collect           | evaluate    | cleanup      |
| :------- | :-------------------- | :-------------------------- | :-------- | :--------------- | :------------------ | :---------------- | :---------- | :----------- |
| L1       | `l1-adapter.ts`       | 读事件序列                  | —         | resolveFoldEntry | runFold             | foldState         | 现有 oracle | —            |
| L2       | `l2-adapter.ts`       | 读 stimulus/script/contract | —         | 建 FakeHost+插件 | turn 循环           | timeline/session  | 现有 oracle | disposeHooks |
| L3       | `l3-adapter.ts`       | 读 cassette                 | —         | 建 FakeHost      | 回放                | trace/timeline    | 现有 oracle | —            |
| B-direct | `b-direct-adapter.ts` | 读 oracles                  | —         | 建 EvalJob       | runPromptfooAdapter | raw.rows          | 现有 oracle | —            |
| B-hosted | `b-hosted-adapter.ts` | 读 probes                   | --version | 隔离环境         | spawn opencode      | EventStore/ndjson | 现有 oracle | rmSync       |
| C        | `c-adapter.ts`        | 读 stimulus                 | —         | mkdtemp          | spawn node          | stdout/exit       | 现有 oracle | —            |

> 原 `*-runner.ts` 文件**直接改造**为 `*-adapter.ts`（不留薄封装，删旧 `runXxxItem`），`run.ts` 删 `runOneItem` 改由 `RunOrchestrator.executeCase` 驱动，与「彻底清除 papers-v1 兼容层」的风格一致。

---

## 6. 与 Phase 2 的边界

本设计**只落地**：

1. `ExecutionAdapter` 接口 + 7 个 adapter 实现（执行语义不变）。
2. `RunOrchestrator` + 三级状态机实例化 + `RUN_TRANSITIONS` 校验。
3. planned / resolved / observed 三值记录（AgentInvocation 路由）。

**推迟到 Phase 2**：

- 持久化 Run/CaseExecution/Attempt 到存储。
- 断点续跑 / 对账（interrupted 恢复流程）。
- 取消（cancelling）与并发调度队列（queued 的完整语义）。

---

## 7. 测试策略（红绿）

1. **红测**：`RunOrchestrator` 非法状态转换抛错（如 `completed → running`）。
2. **红测**：每个 adapter 的 discover 失败 → `AdapterError('discover_failed', 'HARNESS')`。
3. **绿测**：7 个 adapter 改造前后 `AxisItemResult` 逐字段一致（用现有 fixture 对拍）。
4. **绿测**：端到端 `proctor run --dataset eval-agent --environment hosted-plain-v1 --only EVAL-B-PAIRED-TASK-22-OFF` 仍 1/1 PASS。
5. **回归**：45 个历史 run 仍可被 compare 读取，drift 检测不报错。

---

## 8. 评审要点（请重点看）

| #   | 决策点                                                        | 位置 | 需要你确认                                               |
| :-- | :------------------------------------------------------------ | :--- | :------------------------------------------------------- |
| 1   | ExecutionAdapter 8 阶段接口形状                               | §3.1 | 是否接受「相邻阶段可合并」的宽松约定                     |
| 2   | 三值记录用 `ObservedFactsRecorder` 而非直接改 AgentInvocation | §3.2 | 是否接受先落内存事实、Phase 2 再持久化                   |
| 3   | 原 `*-runner.ts` 直接改造为 adapter（删旧函数）               | §5   | 是否接受「不留薄封装、删旧 `runXxxItem`」的低冗余路线    |
| 4   | AxisItemResult → 状态机终态映射                               | §4.3 | `attribution=HARNESS` 映射到 `execution_failed` 是否合理 |
| 5   | Phase 2 边界（持久化/续跑/取消推迟）                          | §6   | 是否接受本次只做内存状态机                               |
