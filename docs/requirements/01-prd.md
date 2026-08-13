# Agent 评测工具最终 PRD

| 字段 | 值 |
| :--- | :--- |
| 状态 | **已冻结（v2）** · 可进入详细设计与 Phase 1 开发 |
| 前身 | `01-需求规格.md`（分析底稿，已并入本文附录后删除） |
| v1 → v2 | 架构评审后修订 D2/D3：A 轴由整盘录制回放改为**三层结构**；B 轴 direct 通道由自研改为**适配成熟评测框架**；hosted 通道由黑箱参考分升级为**轨迹归因** |
| 决策日期 | 2026-07-25 |

---

## 0. 一句话

独立 Node/TS npm 包形态的三轴 Agent 评测引擎：A 轴以**事件直测**为主体、**契约假宿主**测控制流、少量 **cassette 仅作对拍**；B 轴 direct 通道**适配成熟评测框架**出模型矩阵、hosted 通道以 **NDJSON 轨迹归因**做实战对照；C 轴（二期）用 CLI 壳直调工具。用例版本化可演进，结果全指标化，失败必归因。

---

## 1. 冻结决策（v2）

| # | 决策点 | 结论 | 说明 |
| --- | --- | --- | --- |
| D1 | Runner 形态 | **Node/TS 独立 npm 包**，独立仓库；用例/夹具资产留在被测仓库 | v1 保持 |
| D2 | A 轴宿主 | **三层结构**：L1 事件直测（主体）→ L2 契约假宿主（控制流）→ L3 cassette 对拍（宿主边界） | v2 修订（原：整盘录制回放） |
| D3 | B 轴模型通道 | **direct = 适配 promptfoo / Inspect-AI 等成熟框架**（主指标、门禁挂靠）；**hosted = 经真宿主 + NDJSON 轨迹归因**（对照指标） | v2 修订（原：自研双通道） |
| D4 | C 轴工具入口 | 每工具独立 CLI 壳，子进程调用；协议现在冻结，二期实现 | v1 保持 |
| D5 | 分期 | Phase 1 = A + B 轴；C 轴二期 | v1 保持 |

### 1.1 D2 修订理由（记录在案）

宿主 hook 面、插件控制流、领域不变量三者变化频率不同（月级 / 周级 / 几乎不变）。整盘 cassette 把三层锁进一份录制带，宿主升级时重录成本 O(用例数)；三层拆分后宿主漂移只命中 L2/L3 的一处契约实现，成本 O(1)。且万象术以 NDJSON 事件流为 SSOT、状态 = Fold(events)，大多数行为不变量可零宿主直测——被测系统自身的事件溯源架构就是最便宜的测试接入面。

### 1.2 D3 修订理由（记录在案）

直连 API 跑题库矩阵是商品化能力，promptfoo / Inspect-AI 已成熟（矩阵、断言、缓存、并发、报告），自研无增量价值。harness 的稀缺价值在 A 轴与归因体系。hosted 通道并非黑箱：万象术自写 NDJSON 日志，跑完可读日志分诊失败（nudge 发没发 → PROTOCOL；上下文缺工具说明 → CONTEXT；均正常 → MODEL_*），归因污染大半消解。

---

## 2. 产品范围

### 2.1 目标

| ID | 目标 | 验收信号 |
| --- | --- | --- |
| G1 | 三轴评测可分离 | 一次 run 单一主变化因子；交叉轴显式标注 |
| G2 | 用例可变可更新 | `id+rev` 绑定结果；改 expect/stimulus 必升 rev |
| G3 | 结果可指标化 | `metrics.json` 机器可读；`compare` 出漂移三分类 |
| G4 | 时间无关可重放 | 禁裸 sleep；L1/L2 确定性重放 |
| G5 | 失败必归因 | PROTOCOL / CONTEXT / MODEL_SCHEMA / MODEL_TASK / TOOL / HARNESS 六选一主标签 |

### 2.2 非目标

1. 不替代被测仓库自身单元/契约/门禁测试（`tests/` 继续负责纯函数与架构门禁）。
2. 不自研模型矩阵跑批引擎（外包给评测框架，见 D3）。
3. 不修改宿主上游核心；契约验证与录制均以插件/旁路形式挂接。
4. Phase 1 不做 C 轴、分布式、Web UI；LLM-judge 不进任何门禁。

---

## 3. 系统构成

```text
agent-harness（独立 npm 包）
  ├─ case-engine        # 用例装载、schema 校验、rev/digest、suite 解析
  ├─ drivers/
  │    ├─ fold          # A-L1：事件直测——import 被测 Fold 产物，喂事件断折叠态
  │    ├─ fakehost      # A-L2：契约假宿主——hook 面模拟 + SDK 应答 + 剧本模型
  │    ├─ model-adapter # B-direct：promptfoo/Inspect 适配层（题库转换、结果收编）
  │    ├─ hosted        # B-hosted：真宿主子进程 + 日志轨迹采集
  │    └─ shell         # C（二期）：CLI 壳子进程
  ├─ contract/          # 宿主契约定义 + 对真宿主的验证 suite + cassette 对拍
  ├─ attribution/       # 归因分诊器（复用 fold；A/B 两轴共用）
  ├─ oracles/           # 白名单判定器
  ├─ metrics/           # 原子→聚合、门禁、通道分列
  └─ report/            # run 产物、compare、矩阵

被测仓库资产目录：cases/ suites/ profiles/ fixtures/ cassettes/ shells/
（本仓库当前暂存于 systenstest/40-评测工具/harness/；独立项目建立后迁出）
```

关键复用：`attribution/` 的事件折叠分诊器同时服务 A 轴 oracle 与 B-hosted 归因——一套基建两处受益。

---

## 4. A 轴三层设计（v2 核心章节）

### 4.1 L1 事件直测（主体，目标覆盖 ≥70% A 轴用例）

```text
stimulus = 事件序列（手写 fixture 或真实 NDJSON 截取）
执行     = import 被测仓库 Fable 编译产物中的投影/Fold 模块，直接折叠
oracle   = event_fold / state_predicate / no_event
特性     = 零宿主、零网络、毫秒级、逐字节确定
```

- 适用：审查闭环不变量、Cancelled 拦截、重放收敛、Todo/Review 投影规则、幂等键判定。
- 接入契约：被测仓库在 profile 中声明「Fold 入口模块路径 + 事件 schema 版本」；harness 不感知 F# 源码，只 import JS 产物。
- 事件 schema 升版时：L1 用例的 stimulus 需迁移 → 走 `case migrate` 流程，rev 递增。

### 4.2 L2 契约假宿主（控制流层）

- 适用：必须经过 hook 时序才能触发的行为——nudge 触发时机、tool.execute.before 拦截、compaction 后任务恢复、fallback 换模。
- 结构：

```text
1. 宿主契约文件（contract/opencode-v1.17.json）：
   插件用到的 hook 清单、入参形状、SDK 调用应答语义、事件时序规则
   ——初稿直接从 host-docs/00~10 调查结论提炼，现成资产
2. fakehost 驱动按契约实现（薄，只覆盖契约声明的面）
3. 模型侧用剧本（scripted）：按步 assistant_text / tool_calls / terminal，支持有限分支
```

- **契约保真机制**（替代 v1 的 cassette drift 管理）：
  - 同一份契约生成「对真宿主的验证 suite」（`harness contract verify --host opencode@1.17.13`）
  - 低频运行：宿主升级时 + 每周定时
  - 验证红 → 修契约文件与 fakehost 一处 → 全部 L2 用例自动受益（O(1) 维护）

### 4.3 L3 cassette 对拍（宿主边界证据，每宿主版本 3~5 盘）

- cassette 用途从「每用例的测试载体」降级为两件事：
  1. **对拍**：验证 fakehost 与真宿主对同一剧本的行为一致（契约的证据）
  2. **端到端 smoke**：极少量全链路用例
- 格式沿用 v1 设计：`manifest.json`（宿主版本、digest、脱敏声明）+ `timeline.ndjson` + `journal.ndjson`；digest 校验防手改。
- 重录频率：仅随宿主版本，与用例数量解耦。

### 4.4 A 轴 case 的 freeze 字段（v2）

```json
"freeze": {
  "layer": "L1",                          // L1 | L2 | L3
  "fold_entry": "build/src/.../Projection.js",   // L1 必填
  "contract": "opencode-v1.17",                  // L2/L3 必填
  "model_driver": "none | scripted | as-recorded",
  "script": "scripts/review-pass-v1.json"        // L2 scripted 时必填
}
```

validate 规则：L1 禁填 contract/script；L2 必填 contract+script；L3 必填 cassette 引用。

---

## 5. B 轴双通道设计（v2）

### 5.1 direct 通道 = 评测框架适配层（主指标、门禁挂靠）

- harness 不实现模型调用循环；`model-adapter` 负责：
  1. 把 harness case（题库、必调工具、schema 断言）转换为目标框架的评测配置
  2. 驱动框架执行（子进程/库调用），采集原始结果
  3. 收编为 harness 统一的 `results.ndjson` / `metrics.json`，套用归因标签与门禁
- 框架选型放详细设计阶段定（候选：promptfoo、Inspect-AI），PRD 只冻结「适配而非自研」与选型准则：本地可跑、结果可导出 JSON、支持工具调用断言、许可证兼容。
- 工具应答：direct 通道用假工具（fixture 或录制真实返回），保证只测模型。
- `repeats`（默认 3）取通过率抗采样波动。

### 5.2 hosted 通道 = 真宿主 + 轨迹归因（对照指标）

- 经真宿主 + 真万象术跑同一题库（同一 case 文件，profile 切通道，禁止复制两份）。
- **轨迹归因分诊**（v2 新增，取代黑箱参考分）：run 结束后读取 NDJSON 日志与工具调用轨迹，按判定树分诊：

```text
任务失败，查日志：
  期望的 nudge/事件没出现        → PROTOCOL（插件问题）
  上下文组装缺关键注入           → CONTEXT（插件问题）
  插件侧全部正常，模型未调/调错   → MODEL_SCHEMA / MODEL_TASK
  宿主异常（abort/超时/崩溃）     → HARNESS
```

- 分诊器复用 `attribution/` 事件折叠基建；分诊结论写入每条结果的 `attribution` 字段。
- 门禁规则不变：hosted 指标**硬编码不可挂 gate**；用途是「direct 结论在实战语境是否成立」+ 倒挂检测（direct 与 hosted 模型排名不一致时报告醒目提示）。

### 5.3 指标形状

```json
"aggregates": {
  "b_task_pass_rate": {
    "direct": { "model-a": 0.72, "model-b": 0.81 },
    "hosted": { "model-a": 0.65, "model-b": 0.74 }
  },
  "b_hosted_attribution_share": {
    "model-a": { "MODEL_*": 0.8, "PROTOCOL": 0.1, "CONTEXT": 0.1 }
  }
}
```

`b_hosted_attribution_share` 是 v2 新增指标：hosted 失败中归因到插件侧的占比高 → 该修插件而不是换模型。

---

## 6. C 轴（二期）：CLI 壳协议（沿 v1 冻结，不变）

```text
调用：node harness/shells/<tool>.mjs < args.json > result.json
stdin  = {"args": {...}, "context": {"workspace": "<临时副本>", "deadline_ms": 30000}}
stdout = {"ok": true, "result": {...}} | {"ok": false, "error": {"kind": "...", "message": "..."}}
exit 0 = 壳正常（含工具业务失败）；非 0 = 壳/环境故障 → HARNESS
副作用限定 context.workspace 内
```

补充（v2）：L1 事件直测落地后，部分原 C 轴「工具改投影」类用例可改由 L1 覆盖（如 todowrite → TodoChanged 折叠），C 轴聚焦纯工具契约（IO、边界、截断、幂等）。

---

## 7. 分期计划（v2）

### Phase 1：A（L1+L2）+ B（direct 适配 + hosted smoke）

| 序 | 交付 | 验收 |
| --- | --- | --- |
| 1 | 引擎仓库初始化 + case-engine（validate/rev/digest） | 取代本仓库临时校验脚本，行为一致 |
| 2 | **L1 fold 驱动 + 三类 oracle** | ≥5 条事件直测用例全绿；人为改坏 Fold 一条不变量 → 红灯 + PROTOCOL |
| 3 | 宿主契约文件初稿（自 host-docs 提炼）+ fakehost 最小面 | ≥2 条 L2 用例（nudge 时机、review 闭环）通过 |
| 4 | `contract verify` 对真宿主跑通一次 | 契约验证 suite 全绿并留档 |
| 5 | B-direct 适配层（选型 + 转换 + 收编） | 2 模型 × ≥5 case × repeats=3 矩阵产出 |
| 6 | B-hosted smoke + 轨迹归因分诊 | 1 模型跑通；失败条目带分诊归因 |
| 7 | `run` / `compare` / `baseline pin` | compare 三分类：新失败 / 修复 / 资产升版漂移 |

出口门禁：smoke-A（L1+L2）全绿且重跑逐字节一致；direct 矩阵一次跑通；契约验证有真宿主通过记录。

### Phase 2：L3 对拍 + C 轴 + 演进命令

- 录制器插件 + cassette 3~5 盘 + fakehost 对拍通过。
- CLI 壳协议实现 + 首批 2 个本地工具契约 suite 全绿。
- `case new / bump-rev / retire / migrate`；ST-* 导入 ≥10 条（优先落 L1）。

### Phase 3：增强

指标趋势、并行 worker、LLM-judge 参考栏、万象阵进阶 suite。

---

## 8. 验收清单（Phase 1 DoD，v2）

> 勾选状态：见 `docs/process/20-phase1-dod-closure-2026-07-26.md`（2026-07-26）。

- [x] 引擎独立包可运行，不依赖被测仓库构建链（本地 `bin`/`dist`；registry `npx` 发布另议）
- [x] L1：import Fold 产物直测成立；zero-host 用例 ≥5 条
- [x] L2：契约假宿主 + 剧本模型跑通 ≥2 条控制流用例
- [x] `contract verify` 对真宿主（声明版本）通过并留档
- [x] B-direct：评测框架适配层产出 2 模型完整矩阵
- [x] B-hosted：轨迹归因分诊生效，失败条目无「无归因红灯」
- [x] hosted 指标在引擎层面无法配置为 gate
- [x] `compare` 三分类正确；同 `case_rev` 同代码重跑结果一致
- [x] 默认 suite 无网络依赖；需网用例显式标注

---

## 9. 风险登记（v2）

| 风险 | 等级 | 对策 |
| --- | --- | --- |
| 契约文件与真宿主漂移未被发现 | 高 | `contract verify` 双触发（宿主升级时 + 每周定时）；验证红一律阻断 L2 结果发布 |
| Fold 产物接口随重构变动，L1 大面积失效 | 中 | profile 声明 fold_entry + 事件 schema 版本；变动走 `case migrate`，compare 归为资产升版漂移 |
| 评测框架选型绑架（导出格式/许可证变化） | 中 | 适配层隔离：harness 只依赖「配置输入 + JSON 输出」两个面；换框架只改 adapter |
| hosted 分诊判定树误归因 | 中 | 判定树规则版本化；抽样人工复核；`b_hosted_attribution_share` 异常波动告警 |
| fakehost 面覆盖不足（插件用了契约外 hook） | 中 | fakehost 收到契约外调用一律 fail-fast 报 HARNESS，禁止静默兜底 |
| 观察者效应（录制器影响被录行为） | 低（L3 已边缘化） | 录制器只读旁路；对拍时双向核对 |

---

## 10. 待设计阶段细化项

1. 宿主契约文件 schema（hook 条目、SDK 应答语义、时序规则的最小充分字段集）。
2. L1 fold_entry 的接入约定（导出函数签名、事件 schema 版本协商）。
3. B-direct 评测框架选型评审（promptfoo vs Inspect-AI：本地化、工具断言、导出、许可证）。
4. hosted 分诊判定树 v1 规则清单（按失败模式逐条列）。
5. 剧本（scripted model）分支语法与终止条件。
6. `state_predicate` 表达式子集（JSONPath 取值 + 比较，无函数调用）。

---

## 11. v1 → v2 变更对照

| 项 | v1 | v2 |
| --- | --- | --- |
| A 轴主载体 | 整盘 cassette 录制回放 | L1 事件直测 ≫ L2 契约假宿主 > L3 cassette 对拍 |
| cassette 角色 | 每用例一盘、测试载体 | 每宿主版本 3~5 盘、契约对拍证据 |
| drift 成本 | O(用例数) 重录 | O(1) 修契约 |
| B-direct | 自研 OpenAI 兼容客户端 | 适配 promptfoo/Inspect-AI |
| B-hosted | 黑箱参考分 | NDJSON 轨迹归因分诊 + `b_hosted_attribution_share` |
| Phase 1 录制器 | 必须交付 | 移至 Phase 2（随 L3） |

---

## 附录 A：用例更新铁律（可变用例）

| 变更类型 | 是否升 `rev` | 是否允许静默改 | 对 baseline 影响 |
| --- | --- | --- | --- |
| 改 `expect` / `oracles` | 必须 | 否 | 旧 baseline 比对需 `--allow-case-rev-drift` 或重钉 |
| 改 `stimulus` 语义 | 必须 | 否 | 同上 |
| 改 `title`/`owner` 文案 | 可不升 | 是 | 无 |
| `status=deprecated` | 必须记原因 | 否 | 默认 suite 排除 |
| 仅修 harness bug | 不改 case | — | 应用同 case_rev 重跑对比 |

验收不变式：任意两次 run，若 `case_id+rev` 相同，则 stimulus/expect 字节级一致（或 digest 一致）。

## 附录 B：Oracle 类型目录

| type | 适用轴 | 输入 | 通过条件 |
| --- | --- | --- | --- |
| `event_fold` | A | 事件序列 + 期望折叠态 | Fold(events)=expected |
| `event_subsequence` | A | 期望事件名有序子序列 | 子序列匹配 |
| `state_predicate` | A | 布尔表达式（白名单字段） | 为真 |
| `no_event` | A | 禁止出现的事件名 | 未出现 |
| `tool_trace` | B/C | 期望调用名/参数子集 | 轨迹包含 |
| `schema_obedience` | B | 必填工具与 required 字段 | 全部满足 |
| `workspace_assert` | B/C | 文件存在/内容/测试命令 | 断言通过 |
| `tool_result_equals` | C | 期望结构化输出 | 深度相等或 JSONPath |
| `tool_side_effect` | C | 文件系统/进程副作用描述 | 符合 |
| `exit_code` | C | 期望码 | 相等 |
| `metric_threshold` | 全 | 单 case 产出指标 | 落在阈值内 |

实现约束：Oracle 纯判定或只读检查，禁止在 Oracle 内发 prompt；表达式白名单字段，禁止任意代码执行；每次失败返回 `oracle_id` / `message` / `evidence_ref`。

## 附录 C：指标目录

原则：原子指标来自单 case，聚合指标来自 suite/run；每条指标含 `name/axis/unit/aggregation/higher_is_better/gate_threshold?`；门禁只用稳定指标。

A 轴：

| name | 含义 | 聚合 | 建议门禁 |
| --- | --- | --- | --- |
| `a_case_pass_rate` | active case 通过率 | mean | ≥ 1.0（smoke）/ ≥ 0.98（full） |
| `a_invariant_violations` | PROTOCOL/CONTEXT 归因数 | sum | = 0 |
| `a_recovery_pass_rate` | 重启/重放类通过率 | mean | ≥ 1.0 |
| `a_concurrency_pass_rate` | 竞争类通过率 | mean | ≥ 1.0 |
| `a_flaky_rerun_delta` | 同配置重跑不一致数 | sum | = 0 |

B 轴（direct 为主指标，hosted 为对照，见 §5）：

| name | 含义 | 聚合 | 建议门禁 |
| --- | --- | --- | --- |
| `b_task_pass_rate` | 任务断言通过率（按通道分列） | mean | 选型用；不设绝对门禁 |
| `b_schema_obedience_rate` | schema/必调工具服从率 | mean | 可设 ≥ 0.9（仅 direct） |
| `b_required_tool_call_rate` | 必选工具实际调用率 | mean | 按题库 |
| `b_invalid_args_rate` | 工具参数非法率 | mean | lower better |
| `b_avg_steps_to_success` | 成功路径平均步数 | mean | 信息性 |
| `b_cost_tokens_per_pass` | 每成功 case 平均 token | mean | 信息性 |
| `b_refusal_or_empty_rate` | 拒答/空输出率 | mean | lower better |
| `b_hosted_attribution_share` | hosted 失败归因占比分布 | mean | 信息性（v2 新增） |

C 轴（二期）：

| name | 含义 | 聚合 | 建议门禁 |
| --- | --- | --- | --- |
| `c_contract_pass_rate` | 直调契约通过率 | mean | = 1.0 |
| `c_boundary_pass_rate` | 边界/非法输入通过率 | mean | = 1.0 |
| `c_idempotent_pass_rate` | 幂等类通过率 | mean | = 1.0 |
| `c_timeout_truncate_correct` | 超时/截断标记正确率 | mean | = 1.0 |
| `c_via_agent_discover_rate` | 经 Agent 发现并正确调用率 | mean | 可选 |

## 附录 D：CLI 命令面与 Run 产物契约

```text
harness case validate | new | bump-rev | retire | migrate
harness run --axis A --suite smoke-A
harness run --axis B --suite model-core --models m1,m2
harness contract verify --host opencode@<version>       # v2 新增
harness compare --baseline runs/xxx --candidate runs/yyy
harness baseline pin --run runs/xxx --name smoke-A
harness report show --run runs/xxx
```

```text
runs/<run_id>/
  run.json           # 开始时间、git sha、freeze、suite、case 列表与 rev
  results.ndjson     # 一行一个 case 结果（含 attribution、oracle_failures、metrics、artifact_dir）
  metrics.json       # 聚合指标 + gates（形状见 §5.3）
  artifacts/         # 日志、NDJSON 副本、workspace diff
  report.md          # 人读投影；机器真相以 JSON 为准
```

时间无关执行：等待原语仅允许事件谓词、状态谓词、有界 deadline、计数器；用例出现裸 `sleep_ms` → validate 失败（夹具内部 debounce 需标 `harness_internal`）；需网用例标 `requires_network=true` 且不进默认 CI suite。

## 附录 E：术语表

| 术语 | 定义 |
| --- | --- |
| axis | 评测轴 A/B/C 或显式交集（AB/AC/BC） |
| layer | A 轴内层级 L1/L2/L3（v2） |
| case_rev | 用例修订号；与结果绑定 |
| freeze | 一次 run 钉死的因子快照 |
| oracle | 机器判定器 |
| suite | 用例集合 + profile 绑定 |
| baseline | 命名的历史 run，用于 compare |
| attribution | 失败主因标签（六选一） |
| scripted model | 预置回复/工具调用的剧本模型驱动 |
| contract verify | 对真宿主运行契约验证 suite（v2） |

---

*本 PRD 为需求终稿 v2。实现状态以 Phase DoD 勾选为准，禁止提前声称完成。*
