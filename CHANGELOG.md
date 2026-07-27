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

- 包名 `agent-proctor`（CLI `proctor`）；资产协议 `papers-v1`
- `engines.node`：`>=22.22.0`；推荐 `.node-version` **24.18.0**
- promptfoo：Node 达标走标准 CLI，否则 main.js 回退

### Notes

- 完整 Plugin 假宿主明确不做；密钥轮换 / npm 公开发布需使用方操作
