# 00 · 术语与概念（唯一实体）

| 字段   | 值                                                                                 |
| :----- | :--------------------------------------------------------------------------------- |
| 状态   | **现行**                                                                           |
| 日期   | 2026-10-16                                                                         |
| 角色   | 全仓术语与逻辑概念的**唯一实体**。别处只链到本篇对应词条，不另下定义、不互为术语表 |
| 阅读序 | 需求栏最先读                                                                       |

任务状态（Phase 0–8）不写在这里，见 [过程日志](process/01-changelog.md)。

**怎么用：** 每个词条的「哪儿用过」只标 1～3 个权威使用面，不是出现过的文件清单。使用处单向链回本篇。

本术语表以 V2.17 附件领域对象为骨架，融入现有仓库仍有效的操作台口径。领域对象的权威定义见 [02-总体架构与领域设计.md](02-总体架构与领域设计.md) §3；产品能力见 [01-产品需求规格说明书.md](01-产品需求规格说明书.md)；首轮实验口径见 [04-首期实验方案与用例治理.md](04-首期实验方案与用例治理.md)。

---

## 1. 核心领域对象

以下对象在 [02 §3.1](02-总体架构与领域设计.md) 有完整定义，本篇只给一句话定位。

| 对象 | 一句话定位 |
| :--- | :--------- |
| `Case` | 稳定逻辑用例身份/系列，承载同一测试意图在不同版本间的关系 |
| `CaseRevision` | 某个 Case 在一个修订号下的不可变规格正文（输入/前提/预期/Oracle/Rubric/证据/清理） |
| `DatasetRelease` | 用于某一类运行的冻结案例集合及其完整引用闭包（不可变） |
| `SuitePlan` / `RouteStep` | 将 Release 用例按依赖/顺序/前置组成执行路线 |
| `ExperimentPlan` | 一次实验的目标、候选、固定/变化因素、指标、重复与比较协议（执行前冻结） |
| `Experiment` | 一个冻结 ExperimentPlan 的一次真实执行实例 |
| `CandidateConfig` | 一个待测系统候选的版本化配置组合 |
| `FeatureCatalogRelease` | 固定插件版本对应的 package/slice 节点目录快照（不可变） |
| `FeatureControlPoint` | 被测版本实际支持的外部配置入口 |
| `FeatureAblationProfile` | 源定义命名 Profile 或经证明被运行入口接受的配置快照 |
| `FeatureInterventionPlan` | 对一个或多个真实控制点/可选 Profile 的干预计划 |
| `RouteSimulation` | 对已选 Profile 计算的只读路由计划（非实际调用） |
| `EnvironmentProfile` | 一键创建/重置测试环境的版本化配方 |
| `EnvironmentInstance` / `EnvironmentManifest` | 一次真实环境实例及其实际状态/版本/清理证据 |
| `Run` | 某候选/条件在一个预先声明执行块的批次执行 |
| `CaseExecution` | 一个精确 CaseRevision 在某候选/区组/重复编号下的单次计划观测 |
| `Attempt` | 对一个 CaseExecution 的一次物理执行尝试（技术重试不增加样本） |
| `AgentInvocation` | 一次实际 Agent/角色调用的关联实体（父子调用） |
| `Event` | 实际发生的阶段迁移、工具调用、错误、取消、清理等（追加式） |
| `FaultInjectionProfile` / `FaultScenario` | 受控网络/Provider/Host/环境异常的版本化定义 |
| `Artifact` | 日志、输出、截图、diff、文件、trace 等实际证据 |
| `OracleResult` / `Score` | 机器判定、Rubric 评分或人工评价 |
| `MetricSpec` | 指标的定义、公式、单位、作用范围、分母/缺失和聚合规则（版本化） |
| `Comparison` | 按冻结协议对候选进行配对和比较的结果 |

---

## 2. 状态与语义

### 2.1 运行状态机

`run_lifecycle_status`（Run）十态：`created / preflight / queued / running / cancelling / completed / failed / cancelled / blocked / interrupted`。`interrupted` 表示异常退出后待对账，不是成功终态。

`execution_outcome`（CaseExecution）七态：`completed / execution_failed / blocked / cancelled / timed_out / not_run / unknown`。

`evaluation_outcome`（CaseExecution）四态：`pass / fail / indeterminate / not_evaluated`。

`attempt_status`（Attempt）九态：`created / starting / running / completed / failed / cancelled / timed_out / interrupted / unknown`。

**语义边界：** `Run.completed` 表示编排按计划走完、所有计划项获得明确终态、清理已记录、终态清单封存，**不表示所有任务通过**。`evaluation_outcome=pass` 才表示该 Case 按合同通过。详见 [02 §3.4](02-总体架构与领域设计.md)。

### 2.2 用例生命周期与自动化准备度

用例生命周期：`draft → candidate → reviewed → validated → released → deprecated`。

自动化准备度（与生命周期正交）：`not_assessed / manual_only / spec_incomplete / design_ready / blocked`。

### 2.3 兼容状态

`target / compatible_unverified / verified_supported / degraded / unsupported / blocked`。详见 [02 §7.3](02-总体架构与领域设计.md)。

### 2.4 比较 Gate

`eligible / eligible_with_limitations / exploratory_only / blocked`。详见 [02 §5.3](02-总体架构与领域设计.md)。

### 2.5 归因

失败归因六选一：`PROTOCOL / CONTEXT / MODEL_SCHEMA / MODEL_TASK / TOOL / HARNESS`。禁止无归因红灯。

`attribution_tags` 八分类：`product_defect / environment_failure / provider_error / test_data_issue / expected_negative_behavior / flaky_or_nondeterministic / design_pending / unknown`。

---

## 3. 计划 / 解析 / 观测三值

- **`planned`（计划值）**：配置中写明的意图，如界面选择「模型 A」。
- **`resolved`（解析值）**：Adapter/Provider 解析出来的实际值。
- **`observed`（观测值）**：运行中实际观测到的事实。

计划值不能冒充观测事实；未观测到的字段标 `unknown/not_observed/unsupported`。

---

## 4. 快、好、省指标口径

- **快（时间）**：`run_end_to_end_wall_time`（端到端）、`batch_execution_wall_time`（执行批次）、`case_elapsed_wall_time`（单 Case）、平台开销单列。
- **好（质量）**：`planned_success_yield`（计划范围成功产出率，分母含所有计划项）与 `evaluated_pass_rate`（已判定样本通过率，分母只含 pass+fail）双分母；Rubric 维度分列。
- **省（Token/费用）**：input/output/total tokens、Provider 调用数、fallback/角色调用、重试消耗、价格版本、估算/实际费用分开。

详见 [04 §2](04-首期实验方案与用例治理.md)。`Δ` 是同一批人题两侧通过率之差，效果结论用剔除 `CONTEXT` 之后的 Δ。

---

## 5. 功能目录五层区分

功能目录必须区分五件事（[00-项目总览与需求设计基线.md](00-项目总览与需求设计基线.md) §4.9）：

1. **功能/规范包目录**：该版本有哪些 package/slice 节点、定义和关系（可浏览清单，不默认可编辑）。
2. **实际配置控制点**：被测版本明确支持的外部调整入口（如 `WANXIANGSHU_ABLATION_PROFILE`）。
3. **命名 Profile**：预先定义的节点状态组合（`active / borrowed / ablated` 三态）。
4. **默认行为**：无外部控制值时按版本内置规则运行。
5. **实验干预**：本次实验真正改变的受支持控制。

56 个 package 节点 + 3 个 slice 节点是目录计数，**不是 56 个外部开关**。

控制能力分类：`documented_external_setting / named_profile_only / verified_test_interface / fixed_default / observational_only / unknown`。

---

## 6. 源边语义

- **`station-order`**：源定义的顺序约束；仅当 `to=active` 时要求 `from` 为 `active` 或 `borrowed`。
- **`borrow`**：借用前置条件；当 `to=borrowed` 或 `to=active` 时要求 `from` 为 `active` 或 `borrowed`。

两者都参与环检测，但都不是通用业务硬依赖。`parent` 是节点属性，不是边类型。

---

## 7. 保留的 V1 操作台口径

以下术语来自现有仓库，在 V2.17 下仍用于描述现有代码资产的物理形态（[02 §3.2](02-总体架构与领域设计.md) 明确其作为首期物理存储基础）：

| 术语 | 定位 | 与 V2.17 的关系 |
| :--- | :--- | :-------------- |
| **人题** | 人看见的一道题（题号/题干/怎样算对/任务类型） | 对应 `Case` 逻辑身份的用户视角 |
| **引擎条目** | 同一人题落成的 OFF/ON 两份 `*.item.json` | 对应 `CaseRevision` 的物理落盘 |
| **题干** | 给模型的输入全文（`prompt.txt`） | `CaseRevision` 的输入材料 |
| **怎样算对** | 人话判定规则；协议里对应 `expect.oracles` | `Oracle`/`Rubric` |
| **测试集** | 一份人题名单 | 对应 `DatasetRelease` 的选题来源 |
| **组卷** | 一份 `papersets/*.json`，列出引擎条目 | `DatasetRelease` 的物理落盘 |
| **考场** | `rooms/*.json` 宿主冻结 | `EnvironmentProfile` 的物理落盘 |
| **暗号** | `hosted_pass_token`（终态词） | 辅助判定信号，不单独否决 |
| **跑次** | 一次 `proctor run` 写下的结果目录 | 对应 `Run` 的物理落盘 |
| **过挂** | 某引擎条目在某跑次的通过/失败 | `CaseExecution.evaluation_outcome` |
| **CONTEXT** | 归因之一：环境故障（缺密钥/额度/超时未改） | 效果对照中不进 Δ |
| **经济四格** | 弱模型开插件 vs 强模型关插件对照 | 依赖 T6 有效效果数据 |

---

## 8. 三种实验

测模型 / 测万象术 / 测 Agent 三类互斥。无插件 / 有插件 / 同时跑只属于测万象术。详见 [01-产品需求规格说明书.md](01-产品需求规格说明书.md)。

---

## 9. 安全隔离六边界

文件系统 / 命令进程 / 网络 / 凭据 / 控制台 API / Artifact。详见 [02 §7](02-总体架构与领域设计.md)。
