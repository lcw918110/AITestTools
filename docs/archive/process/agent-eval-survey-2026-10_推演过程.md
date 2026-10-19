# Agent/大模型评测方法调研——推演过程（2026-10）

> 本文是过程记录，只存调研原始发现与对照推导；**最终结论见 `docs/10-Agent评测方法调研与优化项.md`**。
> 依据本仓规范「最终报告只要结果，推演过程另文记录」，本文不进日常阅读索引。

---

## 一、调研范围与方法

六路联网检索（2026-10-19），覆盖四个维度：

1. **Agent 评测框架**（SWE-bench / AgentBench / OpenHands / LangSmith）
2. **LLM 评测基准与裁判模型**（OpenAI eval best practices / Autorubric / RubricEval / LLM-as-judge 校验）
3. **Agent 插件/工具调用评测**（MCP-BENCH / MCPMark / ETOM / NVIDIA / Chrome WebMCP）
4. **评测配套**（可观测性平台 LangSmith/Langfuse/Arize/OpenTelemetry；安全红队；CI 持续评测）

---

## 二、各方方法要点摘录

### 2.1 Agent 评测框架

| 框架                 | 核心方法                                               | 关键指标                     | 对本项目的启示                                                      |
| :------------------- | :----------------------------------------------------- | :--------------------------- | :------------------------------------------------------------------ |
| SWE-bench / Verified | 真实 GitHub issue + Docker 环境 + 自动化测试验证补丁   | resolve rate / Pass@1        | 用**可执行验证**而非文本比对；Verified 强调**人工筛选子集**保证质量 |
| AgentBench           | 8 个交互环境（OS/DB/知识图谱/游戏/网页）               | 成功率、F1、奖励、步骤成功率 | 多环境覆盖；但本项目聚焦单插件，不适用全量                          |
| OpenHands Index      | 5 类任务（issue/frontend/testing/检索）+ 成本/耗时维度 | ability/cost/runtime 三维    | **「快好省」三维与本项目高度一致**                                  |
| LangSmith            | 轨迹评估 + 监控 + 人工标注 + A/B 对比                  | —                            | 轨迹级评估 + 人工标注闭环                                           |

**共性结论**：优先验证**最终系统状态**（而非仅文本/工具调用）；基准需**人工筛选 + 程序化验证**双轨保证质量。

### 2.2 LLM 评测基准与裁判模型

OpenAI eval best practices 的**五步闭环**：

1. 定义 eval 目标 → 2. 收集数据集 → 3. 定义指标 → 4. 运行对比 → 5. **持续评测（CE）**

三种 evaluator 组合：

- **Metric-based**（确定性）：exact match、function call accuracy、**executable evals**（可执行验证）
- **Human evals**：多轮盲评、rubric 打分、pass/fail 阈值、共识投票
- **LLM-as-judge**：pairwise / 单答评分 / reference-guided；需**先与人类标注校验一致性**

裁判模型关键教训（Autorubric / RubricEval / 校验论文）：

- 用**显式 rubric**（binary/ordinal/nominal），逐条独立评分，**先给理由再判分**
- **逐 criterion 独立 LLM call**（防 halo 效应）；ensemble 多模型投票优于单 judge
- 缓解**位置偏置、长度偏置、自我偏好偏置**（顺序打乱、长度控制、独立 judge）
- **必须与人类标注校验**（inter-judge agreement / Cohen's κ）；RubricEval 显示 rubric 级判定仍远未解决（GPT-4o Hard 仅 55.97%）

### 2.3 Agent 插件/工具调用评测

| 来源          | 核心方法                                                        | 关键指标                                                                                                |
| :------------ | :-------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------ |
| MCP-BENCH     | 28 服务器 250 工具，多跳任务，规则 + LLM judge 双轨             | name validity / schema adherence / runtime success / 轨迹规划 / 任务完成                                |
| MCPMark       | 127 任务，sandbox + 程序化验证脚本                              | **pass@1 + pass^k 一致性**（最佳模型仅 52.56% pass@1、33.86% pass^4）                                   |
| NVIDIA        | 双层评分：**step-level（过程）+ E2E（结果）**；trace 是唯一对象 | 成功率 + **一致性（3-5 次 trial 的范围而非点估计）** + 工具调用精度 + 参数精度 + steps/成本 per success |
| Chrome WebMCP | 确定性测试（非模型路径）+ 概率性 evals（模型路径）分离          | 工具用途理解 / 选对工具 / 参数正确 / 信息联动 / 用户旅程                                                |

**共性结论**：

- **轨迹 + 结果双轨**：既验工具名/参数正确（step-level），也验最终环境状态（E2E）
- **一致性必须报告**：pass@1 之外必须报 pass^k / 多次 trial 的**范围**，不能只给点估计
- **mock 快回归 + live 集成**分层：mock MCP server 做快回归，live 做真实副作用
- **确定性测试与概率性 evals 分离**：非模型路径用经典确定性测试，模型路径才用 evals

### 2.4 评测配套

**可观测性平台**（LangSmith / Langfuse / Arize Phoenix / OpenTelemetry）：

- 三者都支持 **OpenTelemetry**；Langfuse/Phoenix 最强自托管
- 核心能力：trace 采集 → 评分 → 实验对比 → 人工标注 → 生产监控
- 本项目已有自研 EventStore / NDJSON 探针 / 归因树，属**自研可观测性**，但缺**标准化 trace 格式（OTel）**与**跨 run 轨迹可视化**

**安全红队**（INFUSE / REDAgentBench / ToolHazard / 公开竞赛）：

- **可执行 sandbox + 状态级结果验证**（而非最终回复文本）
- **间接提示注入（IPI）**是核心威胁面：文件/浏览器/邮件/工具/归档/长程工作流
- 双 judge：**工具 judge（程序化验证有害动作）+ prompt judge（最终回复是否隐瞒）**
- 关键洞察：**能力与鲁棒性弱相关**（Gemini 2.5 Pro 高能力高脆弱）；**Recognition–Execution Gap**（19% 违规发生在 agent 已陈述约束之后）

**CI 持续评测**（Langfuse golden dataset / Agent Eval Harness / AgentEval / Braintrust）：

- **golden dataset**：从生产失败沉淀，版本化，每次 PR 跑，回归即 fail CI
- 三阶段：**pre-deploy**（发布前 gate）→ **CI**（每次 PR gate）→ **continuous**（生产流量采样评分）
- 门禁四键：min_pass_rate / min_mean / min_win_rate / max_error_rate

---

## 三、与本项目现状的对照推导

### 3.1 本项目已具备（业界对齐良好）

| 业界最佳实践                   | 本项目现状                                                        | 结论                                                         |
| :----------------------------- | :---------------------------------------------------------------- | :----------------------------------------------------------- |
| 可执行验证（executable evals） | L1/L2/L3 + direct/hosted，12 类 oracle 全部落到真实执行/文件/事件 | ✅ 已对齐，且比多数框架更细                                  |
| 轨迹 + 结果双轨                | 归因树（PROTOCOL/CONTEXT/MODEL_*/TOOL/HARNESS）+ oracle 证据链    | ✅ 已对齐                                                    |
| 快好省三维                     | 首轮实验「快/好/省」指标                                          | ✅ 已对齐（与 OpenHands Index 的 ability/cost/runtime 同构） |
| 不可变版本 + 快照              | Case/CaseRevision/DatasetRelease + RunPlanSnapshot                | ✅ 已对齐（业界少有）                                        |
| 归因标签八分类                 | ATTRIBUTION_TAGS（含 flaky_or_nondeterministic）                  | ✅ 已对齐                                                    |
| golden dataset + 基线对比      | baseline pin / compare / gates                                    | ✅ 已对齐                                                    |
| 故障注入                       | FaultScenario / FaultInjectionProfile 类型已定义                  | ⚠️ 类型层有，执行层待确认                                    |
| 安全边界                       | credentials.scoped_injection / canary_secret 类型已定义           | ⚠️ 类型层有，执行层待确认                                    |

### 3.2 本项目缺口（对照业界）

| 缺口                    | 业界做法                           | 本项目现状                                                                 | 影响                                                          |
| :---------------------- | :--------------------------------- | :------------------------------------------------------------------------- | :------------------------------------------------------------ |
| **裁判模型未落地**      | LLM-as-judge + rubric + 与人类校验 | `RubricSpec.judge`、`Score.source: model_judge` 类型已定义，**无执行实现** | 开放题（无确定性 oracle 的任务质量）无法自动化判定，只能人工  |
| **一致性只记 0 不证明** | pass^k / 3-5 次 trial 范围报告     | `a_flaky_rerun_delta` 单次 run 记 0，代码注释明说「不等于已证明无 flaky」  | 模型题 flaky 无法量化，选型结论可能不稳                       |
| **安全红队未落地**      | 可执行 IPI 注入 + 双 judge         | `scoped_injection`/`canary_secret` 类型已定义，**无注入执行器**            | 插件安全边界无法自动验证（本项目 4.6 安全能力必须可强制执行） |
| **无标准化 trace**      | OpenTelemetry 标准 trace           | 自研 EventStore/NDJSON，无 OTel 导出                                       | 无法对接业界可视化/监控生态                                   |
| **持续评测未闭环**      | 生产流量采样 → 沉淀 golden dataset | 有 baseline/gates，但无「生产失败自动沉淀为回归题」的闭环                  | 题库增长依赖人工，回归集易老化                                |

### 3.3 本项目独有的优势（业界少见，不应丢弃）

- **归因树六选一 + 标签八分类**：业界多数只给 pass/fail，本项目把「谁的责任」分离到协议/上下文/模型/工具/harness，这是评测可信度的关键，业界 SWE-bench 类并不做。
- **计划/事实/结论三分离**（4.2）：业界 LangSmith 等只做 trace，本项目把「配置上计划如此」与「运行时确实如此」显式分离，防自欺。
- **不可变版本 + 快照冻结**：业界 golden dataset 有版本化，但「运行快照冻结 + 配置漂移披露」比多数平台严格。

---

## 四、优化项候选清单（供最终报告引用）

按「价值 × 落地成本」排序，详见最终报告正文。此处只列推导出的候选：

1. 裁判模型（LLM-as-judge）执行落地——补开放题自动化判定
2. 一致性量化（pass^k / 多次 trial 范围）——补 flaky 证据
3. 安全红队执行器（IPI 注入 + canary 验证）——补安全边界强制
4. 持续评测闭环（生产失败 → 回归题沉淀）——补题库演进
5. 标准化 trace（OTel 导出）——补生态对接（低优先，可后置）

---

## 五、参考资料

- A Survey on Evaluation of LLM-based Agents (arXiv 2503.16416)
- SWE-bench / SWE-bench Verified (swebench.com)
- AgentBench (arXiv 2308.03688)
- OpenHands Index (openhands.dev)
- OpenAI Evaluation best practices (developers.openai.com)
- Autorubric (arXiv 2603.00077) / RubricEval (arXiv 2603.25133)
- MCP-BENCH (ICLR 2026) / MCPMark (arXiv 2509.24002) / ETOM (EACL 2026)
- NVIDIA: How to Evaluate AI Agents From Tool Calls to Task Completion
- Chrome WebMCP Evals (developer.chrome.com)
- INFUSE (arXiv 2610.20776) / REDAgentBench (arXiv 2608.10669) / ToolHazard (arXiv 2608.11878)
- Langfuse golden dataset evaluation / Agent Eval Harness CI / Braintrust continuous evaluation
- Arize: 14 Best AI Observability Tools / Compare 7 LLM Evaluation Platforms
