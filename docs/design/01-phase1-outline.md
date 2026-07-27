# Phase 1 详细设计提纲（v1.0）

| 字段     | 值                                     |
| -------- | -------------------------------------- |
| 状态     | **v1.0 已确认** · 可进入接口级细化设计 |
| 依据     | `40-评测工具/02-最终PRD.md`（终稿 v2） |
| 日期     | 2026-07-25                             |
| 已决 ADR | 0001～0005；包名 `**agent-proctor**`   |

---

## 0. 本阶段目标

在不动实现代码的前提下，把 Phase 1（A: L1+L2 + B: direct 适配 + hosted smoke）的：

1. 模块边界与依赖方向
2. 对外 CLI / 产物契约
3. PRD §10 六项细化的设计任务拆分与优先级
4. 与现有脚手架的对照清单

对齐到可评审、可拍板。**不在本提纲中写死全部接口签名**；接口级文档在提纲确认后分篇产出。

---

## 1. 系统上下文

```text
被测项目（考卷库根 papers/，含 exam.json）
  items/ papersets/ rooms/ materials/ [scripts/] [cassettes/]
        │
        ▼  --project <path>
agent-proctor（第三方监考引擎；CLI 建议 `proctor`）
  exam-engine → drivers → oracles / attribution → metrics → report
        │
        ▼
runs/<run_id>/{run.json, results.ndjson, metrics.json, artifacts/, report.md}
```

考卷隐喻：`items`=试题，`papersets`=试卷，`rooms`=考场，`materials`=考材。目录与 JSON 协议均为 `papers-v1`（ADR-0006）。

约束（来自 PRD）：

- 一次 run 单一主变化因子；交叉轴显式标注。
- L1/L2 默认无网络；需网用例 `requires_network=true` 且不进默认 CI suite。
- hosted 指标硬编码不可挂 gate。
- 失败必有六选一归因主标签。

---

## 2. 模块边界（目标架构）

| 模块                    | 职责                                      | Phase 1 范围                                                                                     | 依赖方向              |
| ----------------------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------ | --------------------- |
| `exam-engine`           | 装载、schema 校验、rev/digest、suite 解析 | 完整（取代 Phase 0 `.mjs`）                                                                      | 无业务驱动依赖        |
| `drivers/fold`          | A-L1：动态 import Fold 产物，喂事件       | 完整                                                                                             | exam-engine、oracles  |
| `drivers/fakehost`      | A-L2：契约 hook 面 + scripted 模型        | 最小面（nudge、review 闭环）                                                                     | contract、oracles     |
| `drivers/model-adapter` | B-direct：作业转换 + 调框架 + 收编        | 适配层骨架 + 一个默认框架（选型后）                                                              | exam-engine、metrics  |
| `drivers/hosted`        | B-hosted：真宿主子进程 + 日志采集         | smoke 级                                                                                         | attribution           |
| `drivers/shell`         | C 轴 CLI 壳                               | **不做**（Phase 2）                                                                              | —                     |
| `contract/`             | 宿主契约定义 + `contract verify`          | 初稿契约 + 对真宿主验证 suite                                                                    | fakehost 共享契约文件 |
| `oracles/`              | 白名单判定器                              | A：`event_fold` / `state_predicate` / `no_event`；B：`tool_trace` / `schema_obedience`           | 无副作用              |
| `attribution/`          | 失败分诊（事件折叠复用）                  | A 失败标签 + B-hosted 判定树 v1                                                                  | fold 思路复用         |
| `metrics/`              | 原子→聚合、门禁                           | A/B 指标目录子集；hosted 禁 gate                                                                 | —                     |
| `report/`               | run 产物、`compare`、`baseline pin`       | 完整契约形状                                                                                     | metrics               |
| `cli/`                  | 命令面                                    | `item validate`、`run`、`compare`、`baseline pin`、`contract verify`、`report show`；`init` 可选 | 各模块                |

依赖规则：**drivers 不得互相依赖**；归因与 oracle 不得反向依赖 drivers。

---

## 3. CLI 与 Run 产物（Phase 1 冻结面）

命令面沿用 PRD 附录 D（实现解冻时对齐脚手架现有子命令）：

```text
proctor item validate [--project <path>] [file...]
proctor run --axis A|B --suite <name> [--project <path>] [--models ...]
proctor contract verify --host <id@version>
proctor compare --baseline <run> --candidate <run>
proctor baseline pin --run <run> --name <alias>
proctor report show --run <run>
```

产物目录形状冻结为 PRD 附录 D；`results.ndjson` 每行至少含：`case_id`、`case_rev`、`pass`、`attribution?`、`oracle_failures[]`、`metrics`、`artifact_dir`。

---

## 4. PRD §10 细化项 → 设计任务

| #   | 主题                         | 设计产出文档（确认提纲后写）                          | Phase 1 是否阻塞实现       |
| --- | ---------------------------- | ----------------------------------------------------- | -------------------------- |
| 1   | 宿主契约文件 schema          | `docs/design/10-host-contract-schema.md`              | 阻塞 L2 / contract verify  |
| 2   | L1 fold_entry 接入约定       | `docs/design/11-fold-entry-contract.md`               | 阻塞 L1                    |
| 3   | B-direct 框架选型评审        | `docs/design/02-b-direct-framework-rfp.md` + 选型 ADR | 阻塞 B-direct 默认 adapter |
| 4   | hosted 分诊判定树 v1         | `docs/design/12-hosted-attribution-tree.md`           | 阻塞 B-hosted              |
| 5   | scripted 模型分支语法        | `docs/design/13-scripted-model.md`                    | 阻塞 L2                    |
| 6   | `state_predicate` 表达式子集 | `docs/design/14-state-predicate.md`                   | 阻塞 L1 oracle             |

建议撰写顺序（减少返工）：**2 → 6 → 5 → 1 → 4 → 3**  
（先定 L1 接入与表达式，再定剧本与契约，最后做框架选型实验。）

---

## 5. Phase 1 交付映射（设计↔验收）

| PRD 序 | 交付                   | 设计必须先钉死的点                                                        | 验收信号（摘录）                    |
| ------ | ---------------------- | ------------------------------------------------------------------------- | ----------------------------------- |
| 1      | exam-engine            | item/paperset/room/project schema；digest 算法；与 Phase 0 校验行为对照表 | 取代临时脚本，行为一致              |
| 2      | L1 fold + 三类 oracle  | fold_entry 签名；事件 schema 版本；oracle 失败证据形状                    | ≥5 条 L1 全绿；改坏 Fold → PROTOCOL |
| 3      | 契约 + fakehost 最小面 | 契约字段集；scripted 语法；fail-fast 契约外 hook                          | ≥2 条 L2 通过                       |
| 4      | contract verify        | 验证 suite 生成规则；留档路径                                             | 对声明版本真宿主全绿留档            |
| 5      | B-direct               | 适配输入/输出面；默认框架；repeats                                        | 2 模型 × ≥5 case × 3                |
| 6      | B-hosted smoke         | 判定树 v1；日志采集约定                                                   | 失败条目皆有归因                    |
| 7      | run/compare/baseline   | 漂移三分类规则；baseline 元数据                                           | 三分类正确；同 rev 重跑一致         |

---

## 6. 与现有脚手架对照（冻结，仅记录）

| 区域                                                    | 现状（草稿）                   | 设计确认后动作（预估）                       |
| ------------------------------------------------------- | ------------------------------ | -------------------------------------------- |
| `src/exam-engine/*`                                     | validate/digest/loader/project | 对照 schema 与 Phase 0 `.mjs` 做差异清单后修 |
| `src/cli/*`                                             | `item validate`、`init`        | 补齐 `run`/`compare`/…；语义以本提纲 §3 为准 |
| `schemas/*`                                             | 已有 JSON Schema 草稿          | 接口级设计时升版；digest 字段是否入库再定    |
| `examples/demo-project`                                 | 样例资产                       | 保留角色；字段对齐最终 schema                |
| `src/metrics/catalog.ts`、`src/report/format.ts`        | 占位                           | 按指标目录与产物契约充实                     |
| `drivers/*`、`oracles/*`、`attribution/*`、`contract/*` | **缺失**                       | 设计文档确认后新建                           |

设计阶段 **禁止** 为「补齐上表」而改代码（见 ADR-0003）。

---

## 7. 设计阶段出口标准（DoD）

- [x] 本提纲经确认（v1.0）
- [x] ADR-0001～0006 已采纳；包名定为 `agent-proctor`
- [ ] 新增选型 ADR（B-direct 框架）待 spike 后补（预计 ADR-0007）
- [x] §4 细化设计已过审（见 `00-final-review.md`）
- [x] 「实现解冻检查单」已输出：`16-unfreeze-checklist.md`（**待你确认解冻**）

---

## 8. 开放问题（决议）

| #   | 决议                                                       | 记录        |
| --- | ---------------------------------------------------------- | ----------- |
|     | 包名 `**agent-proctor**`；CLI 建议 `proctor`               | ADR-0005    |
| 2   | 被测侧资产 = **题库/考卷**；根目录 `papers/`               | ADR-0005 §2 |
| 3   | 真宿主钉死本机 **OpenCode 1.18.5**                         | ADR-0005 §3 |
| 4   | Fold **room 可配置多项 entry**；`wanxiangshu` 仅为被测之一 | ADR-0005 §4 |

---

## 9. 下一步

1. 按 §4 顺序撰写六份细化设计（建议先并行 `11-fold-entry` + `14-state-predicate`）。
2. 起草 `02-b-direct-framework-rfp.md`。
3. **实现仍冻结**（ADR-0003），直至细化设计过审；解冻时再改 `package.json` 包名。

---

_本文为详细设计入口提纲 v1.0（已确认）。实现状态仍以 PRD Phase DoD 勾选为准。_
