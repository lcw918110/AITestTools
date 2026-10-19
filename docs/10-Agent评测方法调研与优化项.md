# Agent 评测方法调研与优化项（2026-10）

| 字段 | 值 |
| :--- | :--- |
| 状态 | 调研结论（含优化项清单，未实施） |
| 日期 | 2026-10-19 |
| 范围 | Agent 评测框架 / LLM 评测基准与裁判模型 / Agent 插件与工具评测 / 评测配套（可观测性、安全红队、CI 持续评测） |
| 推演过程 | [agent-eval-survey-2026-10_推演过程.md](archive/process/agent-eval-survey-2026-10_推演过程.md) |

---

## 一、结论

本项目评测方法在**可执行验证、轨迹+结果双轨、快好省三维、不可变版本、归因树**五个维度上**已对齐甚至领先**业界主流做法（SWE-bench、LangSmith、OpenHands 等）。真正的差距不在「测什么」，而在**五个执行层缺口**：裁判模型、一致性量化、安全红队、持续评测闭环、标准化 trace。其中前四个在领域类型层**已预留骨架但未落地实现**，属「设计已备、执行未接」。

---

## 二、已对齐（无需改动，业界少见，不应丢弃）

| 能力 | 本项目实现 | 业界对照 |
| :--- | :--- | :--- |
| 可执行验证 | L1/L2/L3 + direct/hosted，12 类 oracle 落到真实执行/文件/事件 | SWE-bench 的 executable evals 同源，且更细 |
| 轨迹 + 结果双轨 | 归因树六选一 + 12 类 oracle 证据链 | NVIDIA step-level + E2E 双层评分同构 |
| 快好省三维 | 首轮实验「快/好/省」指标 | OpenHands Index 的 ability/cost/runtime 同构 |
| 不可变版本 + 快照 | Case/CaseRevision/DatasetRelease + RunPlanSnapshot | 业界 golden dataset 版本化，本项目更严 |
| 归因树 | PROTOCOL/CONTEXT/MODEL_SCHEMA/MODEL_TASK/TOOL/HARNESS + 标签八分类 | 业界多只给 pass/fail，本项目独有 |
| 计划/事实/结论三分离 | 4.2 显式分离配置计划与运行时事实 | LangSmith 等只做 trace，无此分离 |
| golden dataset + 基线 | baseline pin / compare / gates | Langfuse golden dataset 同构 |

---

## 三、优化项清单（按「价值 × 落地成本」排序）

### 优化项 1：裁判模型（LLM-as-judge）执行落地 —— 高价值 / 中成本

**现状**：`RubricSpec.judge`、`Score.source: 'model_judge'` 类型已定义，**无执行实现**。开放题（无确定性 oracle 的任务质量判定）只能人工。

**业界依据**：OpenAI eval best practices 明确 LLM-as-judge 是规模化评测的必经路径；Autorubric / RubricEval 给出可靠 rubric 判定的工程规范。

**建议落地要点**：
- 复用现有 `RubricSpec.dimensions`（name/scale/weight），补 `judge` 执行器：逐 dimension 独立 LLM call（防 halo），先给理由再判分。
- 判分结果写 `Score.source='model_judge'`，与确定性 oracle 分列，**不混入硬门禁**（与 hosted 归因「禁止 gate」同原则）。
- 上线前**必须与人工标注校验一致性**（inter-judge agreement），否则不启用。

### 优化项 2：一致性量化（pass^k / 多次 trial 范围）—— 高价值 / 低成本

**现状**：`a_flaky_rerun_delta` 单次 run 记 0，代码注释明说「不等于已证明无 flaky」。模型题 flaky 无法量化。

**业界依据**：MCPMark 报告 pass@1 + pass^4；NVIDIA 强调「90%/74% 不是 84%，要报范围而非点估计」。

**建议落地要点**：
- 模型题（direct/hosted）默认 `repeats ≥ 3` 并报告**成功率范围**（min~max）与 pass^k，而非单点。
- 把「repeats 题」的 flaky delta 纳入 `compare` 的回归判定，flaky 超阈值即视为不可比。

### 优化项 3：安全红队执行器（IPI 注入 + canary 验证）—— 高价值 / 高成本

**现状**：`credentials.scoped_injection`、`canary_secret` 类型已定义，**无注入执行器**。本项目 4.6「安全能力必须可强制执行」缺自动验证手段。

**业界依据**：INFUSE / REDAgentBench / ToolHazard 一致用「可执行 sandbox + 状态级结果验证 + 间接提示注入（IPI）」，双 judge（工具 judge 程序化验证有害动作 + prompt judge 验最终回复是否隐瞒）。

**建议落地要点**：
- 在隔离 workspace 注入 canary 指令（文件/材料/归档多表面），用 `canary_secret` 验证是否被外泄或执行。
- 结果归因到安全维度，**不进常规 pass 门禁**（独立安全门禁）。
- 注意业界关键洞察：**能力与鲁棒性弱相关**，安全测试必须独立于能力测试。

### 优化项 4：持续评测闭环（生产失败 → 回归题沉淀）—— 中价值 / 中成本

**现状**：有 baseline/gates，但无「失败自动沉淀为回归题」的闭环，题库增长依赖人工，回归集易老化。

**业界依据**：Braintrust / Langfuse 三阶段评测（pre-deploy → CI → continuous），生产失败提升为 golden dataset 用例。

**建议落地要点**：
- 已有 `baseline pin`/`compare`，补一条「异常 run 一键提升为候选 Case」的路径，把生产/实验中的失败模式沉淀为回归题（本项目 3 核心闭环第 6 步已声明此意图，执行层未接）。

### 优化项 5：标准化 trace（OpenTelemetry 导出）—— 低价值（本项目）/ 高成本

**现状**：自研 EventStore/NDJSON 探针，无 OTel 导出。

**业界依据**：LangSmith/Langfuse/Phoenix 均支持 OTel。

**建议**：**后置**。本项目是自研评测平台，自研探针已满足归因需求，OTel 导出仅在「需要对接外部可视化/监控生态」时才值得做，首期不做。

---

## 四、建议执行顺序

1. **优化项 2（一致性量化）**：成本最低、价值高，先做。
2. **优化项 1（裁判模型）**：补开放题自动化判定，需先建人类校验基准。
3. **优化项 3（安全红队）**：补安全边界强制，成本高但对应本项目硬性要求（4.6）。
4. **优化项 4（持续评测闭环）**：补题库演进。
5. **优化项 5（OTel）**：后置，暂不做。

> 以上仅为调研结论与候选清单，**未实施**。是否立项、先做哪项，需另行对齐（见本仓 grill-me 规范）。
