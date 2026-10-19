# Changelog

> 本文是面向使用者的**发布日志摘要**。完整的逐轮过程日志（含推演、取舍、验证证据）见
> [`docs/process/01-changelog.md`](docs/process/01-changelog.md)。

## 当前状态（cases-v1，2026-10-19）

papers-v1 兼容层已**彻底清除**，引擎直接消费 `CaseRevision` / `EnvironmentProfile` 领域对象。

### 资产模型（cases-v1）

- `cases/`（`*.case.json`）：稳定逻辑用例身份
- `case-revisions/`（`*.case-revision.json`）：不可变修订正文（`content_hash` 校验）
- `dataset-releases/`（`*.dataset-release.json`）：冻结闭包（测试集）
- `environments/`（`*.environment.json`）：运行环境配方
- `candidates/`（`*.candidate.json`）：候选配置

### CLI 命令

| 命令                          | 说明                                                                          |
| :---------------------------- | :---------------------------------------------------------------------------- |
| `proctor init`                | 生成考卷库骨架                                                                |
| `proctor item new`            | 录题（`--mode fold/scripted/cassette/hosted/direct_tool` + 可选 `--dataset`） |
| `proctor item validate`       | 校验题库（支持 `--check-fixtures` / `--strict`）                              |
| `proctor run`                 | 跑试卷（`--dataset` + `--environment`）                                       |
| `proctor compare`             | 漂移 + 效果分列                                                               |
| `proctor baseline pin`        | 钉选基线                                                                      |
| `proctor report show / trend` | 报告                                                                          |
| `proctor contract verify`     | 契约验证                                                                      |
| `proctor cassette record`     | 录播                                                                          |
| `proctor score write`         | 参考分                                                                        |

> 已删除的命令：`item resolve` / `item migrate` / `item retire` / `item bump-rev`。
> 升 rev 现为手动新建 `case_id.rN.case-revision.json`（`revision_number` +1，重算 `content_hash`）；
> 退役现为把 `case.json` 的 `lifecycle` 改为 `deprecated`。

### 执行驱动

`runOneItem` 按 `revision.execution_profile.mode` 分派：

| mode          | 驱动                                                                |
| :------------ | :------------------------------------------------------------------ |
| `fold`        | L1 事件直测（`runL1Item`）                                          |
| `scripted`    | L2 假宿主 + 剧本（`runL2Item`）                                     |
| `cassette`    | L3 对拍（`runL3Item`）                                              |
| `hosted`      | hosted runner / B-direct（`runHostedSmokeItem` / `runBDirectItem`） |
| `direct_tool` | C 轴 CLI 壳（`runCItem`）                                           |

### 判定器（Oracle）

`event_fold` / `event_subsequence` / `state_predicate` / `no_event` / `tool_trace` /
`schema_obedience` / `workspace_assert` / `tool_result_equals` / `tool_side_effect` /
`exit_code` / `metric_threshold` / `stdout_assert`（12 类）。

## 历史里程碑

- **§20–22（2026-10-19）**：papers-v1 兼容层彻底清除 + console 层残留清理 + 文档/注释收口。
- **§13–19（2026-10-16~18）**：V2.17 全量重构基线 → 深迁移阶段 1–6 → console 命名统一（rooms→environments、papersets→dataset-releases）。
- **§12（2026-10-09）**：控制台质量闭环重构。
- **§11（2026-09-23）**：独立验证——可复现测试运行证据。

## 许可

MIT
