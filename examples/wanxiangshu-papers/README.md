# 万象术考卷库（papers-v1）

本目录是 **万象术** 的 agent-proctor 考卷资产。  
万象术 0.8+ **已无** `papers/`，`npm run sync:papers` 会失败。  
L1 最小面已按 `Journal.foldEnvelope` 重接（`smoke-A-L1`）；旧 ST / Review / Nudge / Squad 题仍是 2026-07-27 冻结词，**不要**当现行权威源。

引擎在邻仓 `AITestTools`（包名 `agent-proctor`，CLI `proctor`）。

## 跑

```bash
# 在 AITestTools 仓
export SUT_ROOT="$(cd ../wanxiangshu && pwd)"

npm run proctor -- item validate --project examples/wanxiangshu-papers
npm run smoke:wanxiangshu          # 默认只跑 C 真 git
npm run smoke:wanxiangshu:l1       # foldEnvelope 最小面（RuntimeStarted）
npm run smoke:coordinator          # 已知失效，退出 2
npm run load:wanxiangshu-plugin    # 需完整 Fable dist
npm run smoke:plugin-fakehost      # 需完整 dist；不宣称绿
```

| 试卷                  | 2026-08-13 口径                                      |
| :-------------------- | :--------------------------------------------------- |
| `smoke-A-L1`          | **可跑**：`foldEnvelope` + `RuntimeStarted`（3 题，含线格式） |
| `st-import-L1`        | **已知失效**（旧 Squad / WanEvent 词）               |
| `smoke-A-L2`          | 假宿主 + shim（不加载真 Plugin）                     |
| `smoke-A-L2-plugin`   | 需完整 `dist/.../Plugin.js`；Fable 未绿则无法 import |
| `st-real-git`         | C 轴真 git（`smoke:wanxiangshu` 默认）               |
| `st-coordinator-e2e`  | **已知失效**（PluginWanxiangzhen 已消失）            |
| `hosted-smoke`        | 归因改 EventStore；**真跑阻塞**：Plugin import 缺模块 |

## 重要区分

1. **L1**：`adapters/fold-bridge.mjs` → `Journal.foldEnvelope`（最小面 `RuntimeStarted`）。旧 Review/Nudge/Squad 入口调用即失败。
2. **L2 shim**（`smoke-A-L2`）：官方 hook 名时序；`adapters/l2-control-flow-plugin.mjs`。
3. **L2 真 Plugin**：`opencode-plugin-entry.mjs` 已适配 `{ id, server }`；需完整 dist。
4. **hosted**：耐久为 `refs/wanxiang/store`（`npm run read:event-store`）。`.wanxiangshu.ndjson` / `assistant_completed` **已知失效**。真跑需完整 Plugin dist。
5. **Coordinator HTTP**：**已知失效**。

## 结构

- `adapters/fold-bridge.mjs` — L1（`foldEnvelope`；旧入口诚实失败）
- `adapters/l2-control-flow-plugin.mjs` — L2 shim
- `adapters/opencode-plugin-entry.mjs` — 新导出适配（L2-plugin / 回退加载）
- `rooms/` — fold / fake-host / hosted / coordinator-http / git-coordinator
