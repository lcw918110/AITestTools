# ADR-0011：录题界面化（生命周期状态机 + rubric 声明 + 元数据不升版本）

| 字段   | 值                   |
| :----- | :------------------- |
| 状态   | **已采纳**           |
| 日期   | 2026-10-19           |
| 决策人 | grill-me 对齐（§31） |

## 背景

录题/改题界面（`apps/console/public/bank.js`）仍停留在旧口径：字段只有题干、终态词、`contains/notContains`、`tags`、`notes`，缺少：

- **rubric 声明**：`CaseRevision.expect.rubric` 已定义（§5.1 `RubricSpec`），裁判体系（第 0 期）已实现从 `expect.rubric` 自动读 rubric，但录题后端 `buildCaseRevisionDoc` 不写 `rubric`，导致录的题无法在触发裁判时自动带出 rubric。
- **生命周期**：`buildCaseDoc` 把 `lifecycle` 写死 `released`，`automation_readiness` 写死 `design_ready`，录完即发布，无草稿/审核/验证过程，与 docs/03 §4.1「一键创建候选不能等同于直接发布正式回归测试」矛盾。
- **分层**：`CaseRevision.strata`（`task_type` / `difficulty_level`）未在录题界面暴露。

## 决策

1. **保持配对题 OFF/ON 模式**：`pair_key` 关联 OFF/ON 两个 `CaseRevision` 是首轮 ON/OFF 对照的根基，本次不动。录题/改题仍一次创建/更新 OFF + ON 两个修订。

2. **补 rubric 声明**：录题/改题界面新增 rubric 编辑，写入 `CaseRevision.expect.rubric`（`dimensions: [{ name, scale, weight }]` + 可选 `judge`）。触发裁判时后端从 `expect.rubric` 自动带出，与第 0 期裁判体系打通。

3. **生命周期完整状态机**：`draft → candidate → reviewed → validated → released → deprecated` 线性前进；`candidate / reviewed / validated` 可回退到 `draft`；`released` 后不可回退、不可原地修改题干/预期（只能升版本），仅可前进到 `deprecated`；`deprecated` 为终态。每次流转记录操作者、时间、说明（`lifecycle_history`）。本机单用户信任模型下记录流程声明，不宣称双人审批。

4. **准备度正交可编辑**：`automation_readiness`（`not_assessed / manual_only / spec_incomplete / design_ready / blocked`）独立下拉，与生命周期不耦合。

5. **分层暴露**：`strata.task_type` / `difficulty_level` 暴露为录题字段。

6. **元数据不升版本**：`lifecycle` / `automation_readiness` / `tags` / `lifecycle_history` 属 Case 层元数据，变更只改 `case.json`，不创建新 `CaseRevision`；题干、预期合同（Oracle/Rubric）、分层属修订正文，变更升版本（现有 `updateTask` 已天然升版本）。

## 后果

- 正面：录题即进入可审核、可验证、可发布的完整治理闭环；裁判体系可自动读 rubric；生命周期与准备度两个正交维度在界面分离呈现。
- 负面：录题/改题后端需新增生命周期流转校验、`lifecycle_history` 审计、rubric 写入与 `strata` 写入；界面需新增 rubric 编辑器与状态推进/回退操作。
- 不做：版本差异 UI 与失败 Run 回流 UI（后置到下一期）；不实现双人审批（本机单用户仅流程声明）；不改万象术业务逻辑；不改 OFF/ON 配对机制。

## 相关

- `docs/02-总体架构与领域设计.md` §3.2（生命周期流转规则）
- `docs/03-界面与交互设计.md` §4.1（录题/改题表单字段）
- `docs/process/01-changelog.md` §31
