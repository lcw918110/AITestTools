# 08 · 自主优化日志（2026-08-13）

| 字段   | 值                                      |
| :----- | :-------------------------------------- |
| 状态   | **本轮收口**                            |
| 范围   | hosted EventStore 归因 + 本仓可验证优化 |
| 不做   | LIVE 156、扩题、阶段 C、MCP 全真、push  |

---

## Round 1 · hosted 归因接到 EventStore

**动机**：`.wanxiangshu.ndjson` / `assistant_completed` 在万象术 0.8 已消失。耐久在 Git：`refs/wanxiang/store` → `events/<2-hex>/<EventId>.jsonl`，`event_type=JournalEnvelope`，payload 为 `Envelope.serialize`，Fact 如 `["Runtime",["RuntimeStarted",…]]`。

**改动**：

- 新增 `src/attribution/event-store.ts`：git CLI 只读（不 import Plugin）
- `hosted-runner`：隔离工作区 `git init`；采集 EventStore；artifact `event-store.json`
- 旧 WanEvent 探针扩进 `STALE_HOSTED_PROTOCOL_PROBES`；现行探针用 `RuntimeStarted`
- `scripts/read-event-store.mjs` / `npm run read:event-store`

**验证**：`vitest` EventStore fixture；`read:event-store` 无 tip 退出 2。

**不做**：不改万象术 F#；不跑 LIVE hosted-smoke 装绿。

**风险 / 阻塞**：Plugin 全量 import 仍缺 `PromptDispatcherSend.js` → 真宿主写不进 store。只读解析与 L1 fold 可绿。

---

## Round 2 · 失效试卷与文档对齐

**动机**：`st-import-L1` / `hosted-smoke` 描述仍像可跑绿门禁。

**改动**：paperset 描述改「已知失效 / 真跑阻塞」；ops / papers README 写清 EventStore。

**验证**：`item validate --project examples/wanxiangshu-papers`。

**不做**：不重写全部旧 ST 题词。

---

## Round 3 · 房间采集路径不再指向 ndjson

**动机**：room `durable_log_glob` 仍是 `**/.wanxiangshu.ndjson`，容易被当成挂载证据。

**改动**：`hosted-wanxiangshu-v1`、`product-eval/rooms/hosted-plugin-v1` 改为 EventStore 口径。156 对 ON 题的 `protocol_probes: assistant_completed` **不批量改**（runner 已跳过）。

**验证**：schema 仍接受 `durable_log` 自由字符串。

**不做**：不提交 156 对题库。

---

## Round 4 · L1 补线格式一题

**动机**：最小面已有 compact `RuntimeStarted`；缺 `Envelope.serialize` 反序列化路径。

**改动**：`WX-A-JOURNAL-RUNTIME-03` + 挂入 `smoke-A-L1`。

**验证**：`npm run smoke:wanxiangshu:l1`（需 `SUT_ROOT` + `dist/Journal`）。

**不做**：不重写 `st-import-L1`。

---

## Round 5 · 门禁诚实性（记录，少改）

**动机**：CI `verify` 含 `validate:product-eval` 与 `console:smoke`，但 156 / console **仍未提交**。干净 checkout `13cb161` 会缺这些路径。

**改动**：本轮**不改 CI**（工作区本地仍有这些文件）。只在 backlog 写明：提交 156/console 或把 CI 拆成「已跟踪资产」需人决策。

**验证**：本机 `lint` / `typecheck` / `test`（不跑整仓 `format:check` 去重排 SOURCE.md）。

**不做**：不为过 Prettier 重排 156 对 `SOURCE.md`。
