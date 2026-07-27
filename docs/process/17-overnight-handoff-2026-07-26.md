# 过夜自主推进记录（2026-07-25 → 07-26）

| 字段 | 值                                                                  |
| :--- | :------------------------------------------------------------------ |
| 顺序 | 用户确认 **1→3→2→4**（L2 review → hook probe → promptfoo → hosted） |
| 授权 | 「过程做的决定以及做了什么要记录下来，明早再看」                    |
| 验证 | 见文末命令；`npm run verify` 以当时跑通为准                         |

---

## 1. 做了什么（按顺序）

### ① 第二道 L2：review 闭环（切片 3 收口）

- 新增试题 `DEMO-A-REVIEW-PASS-01`、剧本 `scripts/review-pass-v1.json`（含 `branch` + `tool_result`）。
- 插件合并为 `sut/control-flow-plugin.mjs`（`afterTurn` nudge + `onToolAfter` review）；room 改指它。
- `l2-runner` 支持 `onToolAfter`；`review` 投影提到 state 根（对齐设计 14 谓词）。
- `FakeHost.setLastToolResult`：工具结果由插件决定，再供 branch 使用。
- `smoke-A`：**2/2 PASS**（nudge + review）。

### ③ contract hook probe（切片 4）

- 新增 `src/contract/probe.ts`：
  - FakeHost：契约内 hook 全可触发 + 契约外 fail-fast。
  - 真宿主：对本机 `opencode` 二进制做 `strings`，确认契约 hook 名仍存在（**无副作用**，不注入 probe 插件）。
- `contract verify` 留档含 `verify.json` + `report.md`。
- 本机实测：**PASS opencode@1.18.5（9 probes）**。

**决定**：Phase 1 真宿主 probe 用「版本钉死 + 二进制字符串含 hook 名」，不做运行时插件注入（避免污染用户配置 / 需复杂会话）。若明早要更强 probe，可再加临时 plugin。

### ② promptfoo spike（切片 5）

- 实现 `tool_trace` / `schema_obedience` oracle。
- `runPromptfooAdapter`：默认 **fixture**；`PROCTOR_PROMPTFOO_LIVE=1` 走 live（无密钥则失败）。
- B run：`proctor run --axis B --paperset model-core` → **2 模型 × 5 题 × 3 repeats = 30/30 PASS**（fixture）。
- 写 **ADR-0007**（部分采纳：fixture 通；live 待 API）。

**决定**：环境无 API Key → **不强跑真模型**；不把 promptfoo 写进 dependencies；CI 默认 fixture。

### ④ 真 hosted smoke（切片 6）

- `src/run/hosted-runner.ts`：`opencode --version` + `opencode run --pure …`；失败走归因树。
- 试卷 `hosted-smoke` / 考场 `hosted-opencode-v1` / 题 `DEMO-B-HOSTED-SMOKE-01`。
- 本机实测：**PASS + attribution=CONTEXT**（无密钥时的预期路径）。

**决定**：本夜 hosted =「子进程可拉起 + 失败可归因」，**不是**完整任务正确性评测。完整 hosted 会话评测留待有 provider 之后。

---

## 2. 自主决定一览（需你复核）

| #   | 决定                                                                            | 可反对点                                              |
| --- | ------------------------------------------------------------------------------- | ----------------------------------------------------- |
| D1  | L2 插件面 = `afterTurn` + `onToolAfter`（demo 约定，非 OpenCode 官方 API 镜像） | 对接万象术时可能要改名/改签名                         |
| D2  | hook 真宿主探针 = 二进制 strings，非运行时 hook 注入                            | 覆盖弱于真触发；但零副作用                            |
| D3  | B-direct 默认 fixture；live 显式开关                                            | DoD「真模型」未满足，只满足管道与规模形状             |
| D4  | 不安装 promptfoo 依赖，直到 live 收编完成                                       | 与「spike=promptfoo」略不一致，但符合 ADR-0004 防锁死 |
| D5  | hosted smoke 无密钥失败记 CONTEXT 且 **算 PASS**（测归因链路）                  | 若你希望无密钥必须红，可改门禁语义                    |
| D6  | 指标名 `a_case_*` / 归因 `HARNESS` 仍不改（既有 ADR）                           | —                                                     |

---

## 3. 尚未完成 / 明早建议

1. **有 API Key 后**：`PROCTOR_PROMPTFOO_LIVE=1` 补全 promptfoo eval 解析，升 ADR-0007。
2. **更强 contract probe**（可选）：临时 plugin 真触发 `tool.execute.before`。
3. **hosted 真任务题**（可选）：有 provider 后断言工具/文本，而不仅是归因。
4. 文档：`01-phase1-outline.md` 仍有旧 `harness`/`case` 字样，可择机 scrub。
5. **不要**在需求 PRD 上勾「Phase 1 完成」——A 较齐，B live/真任务仍欠。

---

## 4. 明早快速复查命令

```bash
npm run verify
npm run proctor -- run --axis A --paperset smoke-A --project examples/demo-project
npm run proctor -- run --axis A --paperset smoke-A-L1 --project examples/demo-project
npm run proctor -- contract verify --host opencode@1.18.5
npm run proctor -- run --axis B --paperset model-core --project examples/demo-project
npm run proctor -- run --axis B --paperset hosted-smoke --project examples/demo-project
```

---

_写于自主推进结束时；与 `docs/README.md`「当前阶段」同步更新。_
