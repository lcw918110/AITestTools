# Phase 提纲（Phase 1 + Phase 2 合并）

| 字段   | 值                                          |
| :----- | :------------------------------------------ |
| 状态   | **历史规格入口**（实现以代码与 DoD 为准）   |
| 合并自 | `01-phase1-outline` + `22-phase2-outline`   |
| 依据   | [PRD](../v1-requirements/01-prd.md) v2         |
| 日期   | 2026-07-25（P1）/ 2026-07-26～27（P2 状态） |

> 接口级现行规格仍分篇：`10`～`15`。本文保留模块边界、交付映射与 Phase 2 落地对照，避免两份提纲漂移。

---

## A. Phase 1（设计目标 · 已收口）

### A.0 目标

把 Phase 1（A: L1+L2 + B: direct 适配 + hosted smoke）的模块边界、CLI/产物契约、PRD §10 细化任务对齐到可实现。接口签名见分篇设计，不在此写死。

### A.1 系统上下文

```text
被测项目（考卷库根 papers/，含 exam.json）
  items/ papersets/ rooms/ materials/ [scripts/] [cassettes/]
        │
        ▼  --project <path>
agent-proctor（CLI：proctor）
  exam-engine → drivers → oracles / attribution → metrics → report
        │
        ▼
runs/<run_id>/{run.json, results.ndjson, metrics.json, artifacts/, report.md}
```

约束：一次 run 单一主变化因子；L1/L2 默认无网；hosted 指标不可挂 gate；失败六选一归因。

### A.2 模块边界

| 模块                                                                        | 职责                     | Phase 1 原范围 | 现况（相对原提纲）           |
| :-------------------------------------------------------------------------- | :----------------------- | :------------- | :--------------------------- |
| `exam-engine`                                                               | 装载、schema、rev/digest | 完整           | 已落地                       |
| `drivers/fold`                                                              | A-L1                     | 完整           | 已落地                       |
| `drivers/fakehost`                                                          | A-L2                     | 最小面         | 已落地                       |
| `drivers/model-adapter`                                                     | B-direct                 | 骨架+默认框架  | promptfoo（ADR-0007）        |
| `drivers/hosted`                                                            | B-hosted                 | smoke          | 已落地                       |
| `drivers/shell`                                                             | C 轴                     | **原不做**     | **Phase 2 最小面已绿**       |
| `contract/` / `oracles/` / `attribution/` / `metrics/` / `report/` / `cli/` | 见原分工                 | Phase 1 面     | 已落地；CLI 已扩 item 演进等 |

依赖规则：drivers 不得互依；归因与 oracle 不反向依赖 drivers。

### A.3 CLI 与 Run 产物（冻结面 + 后续扩展）

```text
proctor item validate | new | bump-rev | retire | migrate
proctor run --axis A|B|C --paperset <名> [--project] [--concurrency]
proctor contract verify --host <id@version>
proctor compare --baseline <run> --candidate <run>
proctor baseline pin --run <run> --name <alias>
proctor score write --run <run> --item <id> --value <分>
proctor report show | trend
proctor cassette record …
```

产物形状见 PRD 附录 D；`compare` 另含效果分列与 `effect_compare.md`。

### A.4 PRD §10 → 设计分篇

| #   | 主题            | 文档                                                                                            |
| :-- | :-------------- | :---------------------------------------------------------------------------------------------- |
| 1   | 宿主契约        | [06-host-contract-schema](06-host-contract-schema.md)                                           |
| 2   | Fold 入口       | [03-fold-entry-contract](03-fold-entry-contract.md)                                             |
| 3   | B-direct 选型   | 归档 `../archive/design/02-…` + [ADR-0007](../architecture/adr/0007-promptfoo-spike-fixture.md) |
| 4   | hosted 归因树   | [07-hosted-attribution-tree](07-hosted-attribution-tree.md)                                     |
| 5   | scripted 模型   | [05-scripted-model](05-scripted-model.md)                                                       |
| 6   | state_predicate | [04-state-predicate](04-state-predicate.md)                                                     |

协议总览：[02-protocol-papers-v1](02-protocol-papers-v1.md)。

### A.5 Phase 1 交付映射

| 交付                 | 验收信号（摘录）        |
| :------------------- | :---------------------- |
| exam-engine          | 取代临时脚本            |
| L1 fold + oracle     | ≥5 L1 全绿              |
| 契约 + fakehost      | ≥2 L2                   |
| contract verify      | 真宿主留档绿            |
| B-direct             | 2 模型 × ≥5 × 3         |
| B-hosted smoke       | 失败皆有归因            |
| run/compare/baseline | 三分类；同 rev 重跑一致 |

DoD 收口见 [`../process/03-phase1-dod.md`](../process/03-phase1-dod.md)。

### A.6 开放问题（已决议）

包名 `agent-proctor`、考卷隐喻、OpenCode 1.18.5、Fold 多 entry → [ADR-0005](../architecture/adr/0005-naming-host-fold.md)。

---

## B. Phase 2（PRD 范围 · 最小面状态）

| 字段 | 值                                            |
| :--- | :-------------------------------------------- |
| 状态 | **最小可运行面已绿；不宣称 Phase 2 整体完成** |
| 前置 | Phase 1 DoD；万象术 L1/L2/hosted 已通         |

### B.1 PRD 对照

| PRD 项                                   | 本仓状态                                                                             |
| :--------------------------------------- | :----------------------------------------------------------------------------------- |
| L3 cassette 3~5 + 对拍                   | **smoke-A-L3 6/6**；录制见 archive process 25–26                                     |
| C 轴 CLI 壳 + 2 suite                    | **smoke-C-echo / write 绿**；万象术另有 `st-real-git`                                |
| `item new / bump-rev / retire / migrate` | **已实现**                                                                           |
| ST-\* 导入 ≥10（优先 L1）                | **st-import-L1** + **st-real-git** 覆盖 01–16；**st-coordinator-e2e** 真 HTTP 最小面 |
| 录制器插件                               | **最小面绿**；`PROCTOR_RECORD_CASSETTE`                                              |
| 完整 Plugin 假宿主（stubbed-ctx）        | **smoke-A-L2-plugin**（加载真 Plugin.js；非 MCP 全真）                               |

### B.2 已落地路径

| 模块             | 路径 / 命令                                              |
| :--------------- | :------------------------------------------------------- |
| cassette         | `src/drivers/cassette/`                                  |
| L3 / C runner    | `src/run/l3-runner.ts`、`c-runner.ts`                    |
| 演进 CLI         | `proctor item new \| bump-rev \| retire \| migrate`      |
| 录制             | `recorder-plugin.mjs` + `PROCTOR_RECORD_CASSETTE`        |
| Coordinator HTTP | `shells/st-coordinator-http.mjs` · `st-coordinator-e2e`  |
| Plugin 假宿主    | `rooms/fake-host-plugin-v1` · stubbed ctx in `l2-runner` |

### B.3 复查命令

```bash
export PATH="/usr/local/bin:$PATH"
export SUT_ROOT=/path/to/wanxiangshu
npm run verify
npm run smoke:wanxiangshu          # 仅 C 真 git
npm run smoke:wanxiangshu:l1       # 已知失效
npm run smoke:coordinator          # 已知失效
npm run smoke:plugin-fakehost      # 需完整 dist
npm run proctor -- run --axis A --paperset smoke-A-L3 --project examples/demo-project
npm run proctor -- run --axis C --paperset smoke-C-echo --project examples/demo-project
```

### B.4 明确不宣称

- Phase 2 整体完成（ST 全矩阵经 Coordinator 重跑未做）
- npm 公开发布
- FakeHost ≡ 真 OpenCode / 完整 MCP 工具面（假宿主仅 stubbed-ctx MVP）

---

## C. 相关

- 需求：[PRD](../v1-requirements/01-prd.md)
- 测试：[../test/01-wanxiangshu-ops.md](../test/01-wanxiangshu-ops.md)
- 验收：[`../process/`](../process/)
