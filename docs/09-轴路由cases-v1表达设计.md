# 09-轴路由 cases-v1 表达设计

> 状态：现行
> 前置：06-V2.17深迁移方案 §2.4「废弃轴路由」、§4.1「方案 A 字段扩展」
> 权威口径：02 §3.1、05 §3（领域对象与类型映射）

## 1. 问题与目标

06 方案 §2.4 决策「废弃 A/B/C 轴路由」，但 `examples/demo-project`（21 题）与 `examples/wanxiangshu-papers`（32 题）的 A/C 轴题依赖**运行时执行驱动**（fold 入口、契约脚本、cassette、adapter），这些信息在 cases-v1 的 `CaseRevision`/`EnvironmentProfile` 中**无字段承载**，导致适配层 `cases-v1-adapter.ts` 只能硬编码 B 轴 hosted（`axis: 'B'`、`model_driver: 'live'`、`kind: 'hosted'`）。

本设计目标：**在不恢复「轴」概念的前提下，用 cases-v1 领域语言重新表达执行驱动**，使 demo/wanxiangshu 的 A/C 轴题能通过 cases-v1 运行路径正确还原并执行。

## 2. 核心决策

1. **不恢复 `axis`/`layer` 字段**。轴（A/B/C）与层（L1/L2/L3）是 papers-v1 的路由概念，cases-v1 用 `strata`（任务分层）+ 执行配置字段替代。
2. **执行驱动字段按归属拆两处**：
   - **题目级**（原 `item.freeze`）→ 扩展 `CaseRevision`，新增 `execution_profile` 字段。
   - **环境级**（原 `room`）→ 扩展 `EnvironmentProfile.recipe`，新增 `kind`/`model_driver`/`fold_entries`/`adapter`/`sut`/`contract`/`event_schema` 字段。
3. **适配层按 `strata.task_type` 路由**（替代 `item.axis`），按 `execution_profile` 还原 `FreezeA`/`FreezeBC`。

## 3. 字段设计

### 3.1 CaseRevision 扩展

新增 `execution_profile`（可选，仅 A/C 轴题需要）：

```jsonc
// case-revision.schema.json 新增
"execution_profile": {
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "mode": { "enum": ["fold", "scripted", "cassette", "hosted", "direct_tool"] },
    "layer": { "enum": ["L1", "L2", "L3"] },
    "fold_entry": { "type": "string" },
    "event_schema": { "type": "string" },
    "session_id": { "type": "string" },
    "contract": { "type": "string" },
    "script": { "type": "string" },
    "cassette": { "type": "string" }
  }
}
```

| 原字段（item.freeze） | 新字段（execution_profile）      | 说明                                                  |
| :-------------------- | :------------------------------- | :---------------------------------------------------- |
| `axis`（A/B/C）       | `strata.task_type`               | 轴废除，用任务类型表达                                |
| `layer`（L1/L2/L3）   | `execution_profile.layer`        | 保留层语义（执行模式路由）                            |
| `fold_entry`          | `execution_profile.fold_entry`   | L1 fold 入口                                          |
| `event_schema`        | `execution_profile.event_schema` | 事件 schema                                           |
| `session_id`          | `execution_profile.session_id`   | 会话 id                                               |
| `contract`            | `execution_profile.contract`     | L2 契约                                               |
| `script`              | `execution_profile.script`       | L2 脚本                                               |
| `cassette`            | `execution_profile.cassette`     | L3 cassette                                           |
| `model_driver`        | `execution_profile.mode`         | 执行模式（fold/scripted/cassette/hosted/direct_tool） |

### 3.2 EnvironmentProfile.recipe 扩展

```jsonc
// environment.schema.json recipe 新增
"kind": { "enum": ["fold", "fake-host", "cassette", "live-model", "hosted", "direct-tool"] },
"model_driver": { "enum": ["none", "scripted", "as-recorded", "live"] },
"fold_entries": {
  "type": "object",
  "additionalProperties": {
    "type": "object",
    "required": ["module", "export", "signature", "event_schema"],
    "properties": {
      "module": { "type": "string" },
      "export": { "type": "string" },
      "signature": { "enum": ["session_fold_v1", "pure_fold_v1"] },
      "event_schema": { "type": "string" },
      "resolve_root": { "enum": ["sut", "project"] },
      "normalize": { "enum": ["json_clone", "none"] }
    }
  }
},
"adapter": {
  "type": "object",
  "properties": {
    "framework": { "type": "string" },
    "config": { "type": "string" },
    "repeats": { "type": "integer" },
    "hook_style": { "enum": ["demo-v1", "opencode-v1"] },
    "workspace": { "type": "string" },
    "skip_hook_dispatch": { "type": "boolean" }
  }
},
"sut": {
  "type": "object",
  "properties": {
    "name": { "type": "string" },
    "root_env": { "type": "string" },
    "root_rel": { "type": ["string", "null"] }
  }
},
"contract": { "type": "string" },
"event_schema": { "type": "string" }
```

| 原字段（room） | 新字段（recipe）      | 说明            |
| :------------- | :-------------------- | :-------------- |
| `kind`         | `recipe.kind`         | 环境类型        |
| `model_driver` | `recipe.model_driver` | 模型驱动        |
| `fold_entries` | `recipe.fold_entries` | L1 fold 入口表  |
| `adapter`      | `recipe.adapter`      | L2/C 轴 adapter |
| `sut`          | `recipe.sut`          | SUT 根          |
| `contract`     | `recipe.contract`     | 契约            |
| `event_schema` | `recipe.event_schema` | 事件 schema     |

## 4. 适配层改造

`cases-v1-adapter.ts` 从「硬编码 B 轴 hosted」改为「按 execution_profile 还原」：

- `caseRevisionToItemDoc`：按 `strata.task_type`/`execution_profile.mode` 决定还原 `FreezeA`（fold/scripted/cassette）或 `FreezeBC`（hosted/direct），`axis` 从 `execution_profile.mode` 推导（fold/scripted/cassette → 'A'，hosted/direct_tool → 'B'，direct_tool 含 git → 'C'）。
- `environmentToRoom`：按 `recipe.kind` 还原 `kind`/`model_driver`/`fold_entries`/`adapter`/`sut`/`contract`/`event_schema`。

## 5. 迁移脚本扩展

`scripts/migrate-v2.mjs` 的 `toCaseRevision` 新增 `execution_profile` 构造（从 `item.freeze` 提取 mode/layer/fold_entry/event_schema/session_id/contract/script/cassette），`strata` 从 `item.axis` 推导 `task_type`；`envProfile.recipe` 新增 `kind`/`model_driver`/`fold_entries`/`adapter`/`sut`/`contract`/`event_schema`。

### 5.1 配对实验的环境按侧解析

**问题**：`proctor run` 只接受一个 `--environment`，同一 release 里的 ON/OFF 两侧共用它。
配对实验的设计前提是「同一道题、同一套判定口径，只差插件开关」
（`tests/oracles/paired-on-off-parity.test.ts` 开头注释）。共用环境时 OFF 侧也挂了插件，
差值不再是「有插件 vs 无插件」，配对结论失效。

**方案**：environment 声明可选的 `paired_environments` 映射，run 按修订所在侧解析。

```json
{
  "environment_profile_id": "hosted-plugin-v1",
  "paired_environments": {
    "off": "hosted-plain-v1"
  }
}
```

- 侧由 `case_revision_id` 的后缀判定：`.off` / `.on`（缺失时视为无侧，用默认环境）。
- `paired_environments` 缺省或该侧无映射时，回落到 `--environment` 指定的环境，
  保持既有单环境行为不变。
- 映射目标必须是已存在的 environment_profile_id，**执行时校验**（`resolveDatasetItems`
  解析该侧环境时找不到即抛错）。`proctor item validate` 只做 schema 校验，不检查映射目标
  是否存在，故悬空引用要到跑卷时才暴露。
- **所有按题执行的命令都必须消费解析后的按侧环境**，不能只接 `--environment` 的基准值。
  当前覆盖 `proctor run` 与 `proctor redteam`（两者共用 `resolveDatasetItems` 产出的
  `RunCaseInput.environment`）。新增命令若自行遍历题目，必须同样取 `runCase.environment`，
  否则会重演「OFF 侧也挂插件」的失效——2026-11 的 `redteam` 就漏接过这一条。

**为什么放在 environment 而不是 dataset-release**：配对是「环境能力差异」的表达，
不是数据集闭包的一部分；把映射写进 release 会让同一份冻结闭包因环境组合不同而变义。

**配对两侧的配置差异是必然的（2026-11-09 实测）**：`paired_environments` 只保证「按侧选对
环境」，**不保证两侧配置只差插件**。挂万象术插件的一侧会被插件接管 agent 清单——插件
`ManagedAgentConfig.validate` 拒绝 legacy agent 名并按固定 `requiredNames`（`orchestrator`
/ `manager` / `engineer` / `devops` / `plan` / `bookkeeper`）强制建条目，admission 层还要求
根会话 agent 与插件认知一致。故 ON 侧 `host_agent` / `managed_agents` 没有选择余地。
配对结论应表述为「**有无插件及其强制接管的角色体系**」，不得声称「只差插件一行」。

## 6. 不做的事

- 不恢复 `axis`/`layer` 作为一级字段（轴概念保持废除）。
- 不改 7 个 runner 的执行逻辑（`runL1Item`/`runL2Item`/`runL3Item`/`runCItem`/`runBDirectItem`/`runHostedSmokeItem` 内部不变，仍消费 `ItemDoc`/`RoomDoc` 旧形状）。
- 不新建独立资产类型（遵循 06 §4.1 方案 A「扩展字段」）。
- 不改万象术业务逻辑（`wanxiangshu-papers` 是考卷库资产，迁移的是评测格式，非被测系统业务）。

## 7. 验收标准

1. demo-project 与 wanxiangshu-papers 的 cases-v1 资产通过 schema 校验。
2. 适配层能正确还原 A/C 轴题的 `FreezeA`（layer/fold_entry/contract/script/cassette）与 room 的 `kind`/`fold_entries`/`adapter`。
3. `proctor run --dataset <demo/wanxiangshu dataset> --environment <env>` 能走通（执行语义与 V1 等价）。
4. 现有 product-eval（B 轴 hosted）路径不回归。
