# Changelog

## Unreleased

### Added

- A 轴：L1 Fold 事件直测；L2 假宿主+剧本；L3 cassette / journal 对拍
- B 轴：promptfoo direct（fixture/live）；hosted NDJSON 归因；`PROCTOR_RECORD_CASSETTE` 录制挂钩
- C 轴：CLI 壳 echo / write 契约 suite
- `proctor item new / bump-rev / retire / migrate`；`compare` / `baseline pin`；`contract verify`；`cassette record`
- paperset `gates` 写入 `metrics.json` 并参与 run 退出码
- `proctor run --concurrency N`；`proctor report trend`
- `metric_threshold` oracle（L1 / B-direct / C）
- `workspace_assert` / `tool_result_equals`（C 轴）
- `tool_side_effect` 正式 oracle；L2 `metric_threshold`；demo C 题接上 workspace/result/side_effect
- `npm run smoke:offline` 离线冒烟套件
- hosted：NDJSON 探针短等轮询（缓解 `assistant_completed` 异步落盘竞态）
- 万象术 ST-\* → L1 导入 ≥10（仓外题库）；OpenCode 录制插件最小面

### Changed

- 万象术 Plugin 路径改为 `dist/Infrastructure/OpenCode/Plugin/Plugin.js`（优先）；兼容 `{ id, server }` 导出
- `smoke:wanxiangshu` 默认只跑 C 真 git；Coordinator 标为已知失效（退出 2）
- L1：`fold-bridge` 改接 `Journal.foldEnvelope`；`smoke:wanxiangshu:l1` 跑 `RuntimeStarted` 最小面（含线格式）
- hosted 归因改读 `refs/wanxiang/store`（EventStore）；旧 ndjson / WanEvent 探针不当挂载
- hosted 不再把 `.wanxiangshu.ndjson` / `assistant_completed` 当插件挂载健康信号
- 包名 `agent-proctor`（CLI `proctor`）；资产协议 `papers-v1`
- `engines.node`：`>=22.22.0`；推荐 `.node-version` **24.18.0**
- promptfoo：Node 达标走标准 CLI，否则 main.js 回退
- 控制台题库：严格版（强制升版本、终态词⊂题干、录题回滚、删除 confirmId、录题题号 `PAIRED-TASK-NN`）

### Notes

- Plugin 假宿主：stubbed-ctx MVP 已开（`smoke-A-L2-plugin`）；不宣称 FakeHost ≡ 真 OpenCode / MCP 全真
- 真 Coordinator HTTP 最小面：`st-coordinator-e2e`（**已知失效**，万象术已无 PluginWanxiangzhen）
- 密钥轮换 / npm 公开发布需使用方操作
- CI 显式挂 `validate:product-eval`（无密钥）；product-eval 效果题扩至 16 对（+12～16：公开改编/启发自研）
- product-eval 配对题库经 2h 采集流水线扩至 **156** 对（ROUND18 收束；见 `docs/process/bank-ingest-staging/PIPELINE-DONE.md`）
