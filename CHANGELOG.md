# Changelog

## Unreleased

### Added

- 控制台测试看板 V1：`GET /api/runs/view` 的 `dashboard`（配置条、绿红矩阵、CONTEXT 超时未改文件不进效果 Δ）
- 过程栏改为单一当前态日志；打开的任务 T1–T7；开发过程：Grill → 设计 → 编码规范 → 自测 → 代码审查
- A 轴：L1 Fold 事件直测；L2 假宿主+剧本；L3 cassette / journal 对拍
- B 轴：promptfoo direct（fixture/live）；hosted NDJSON 归因；`PROCTOR_RECORD_CASSETTE` 录制挂钩
- C 轴：CLI 壳 echo / write 契约 suite
- `proctor item new / bump-rev / retire / migrate`；`compare` / `baseline pin`；`contract verify`；`cassette record`
- paperset `gates` 写入 `metrics.json` 并参与 run 退出码
- `proctor run --concurrency N`；`proctor report trend`
- `metric_threshold` oracle（L1 / B-direct / C）
- `stdout_assert` oracle（hosted 回复文本：包含 / 不含 / 正则）；校准 14 对已接上
- `workspace_assert` / `tool_result_equals`（C 轴）
- `tool_side_effect` 正式 oracle；L2 `metric_threshold`；demo C 题接上 workspace/result/side_effect
- `npm run smoke:offline` 离线冒烟套件
- hosted：NDJSON 探针短等轮询（缓解 `assistant_completed` 异步落盘竞态）
- 万象术 ST-\* → L1 导入 ≥10（仓外题库）；OpenCode 录制插件最小面

### Changed

- product-eval 试题 `tags` 只保留任务类型；去掉 `paired` / `plugin-off` / `plugin-on` / `effect`。录题向导不再写入这些词；OFF/ON 只按条目 id 识别
- 操作台需求/设计改为：测试配置 = 选题 + 考场；用途与默认卷（模板）后做
- hosted：`hosted_pass_token` 降为辅助信号；缺暗号或空 stdout 不再一票否决，必须继续跑 `workspace_assert` 等 oracles。报告（`hosted-run.json` / `results.ndjson` / `run.json` / `report.md` / `effect_compare.md` / 控制台摘要）写明「暗号：有/无」
- hosted 效果题：超时（status=null）或非 0 退出仍跑 `workspace_assert`。仓库断言全过 → 整题 PASS，超时/`host_exit` 只记辅助。超时且材料未改 → FAIL CONTEXT；超时且改错 → FAIL MODEL_TASK。PROTOCOL focus 不能把工作区失败改写成 PROTOCOL。item 里的 `exit_code` 字段保留，hosted 效果路径上超时/被杀时不单独否决。
- 配对题 156：拒答正则纳入 `No` / `No—` / `Nope`，避免把 “No—vague pings…” 当假阴性
- 控制台录题第一刀：新题挂校准卷、禁 Text-only 题干、stdout_assert、ON 探针换为 RuntimeStarted / JournalEnvelope
- `smoke:wanxiangshu` 默认只跑 C 真 git；Coordinator 标为已知失效（退出 2）
- L1：`fold-bridge` 改接 `Journal.foldEnvelope`；`smoke:wanxiangshu:l1` 跑 `RuntimeStarted` 最小面（含线格式）
- hosted 归因改读 `refs/wanxiang/store`（EventStore）；旧 ndjson / WanEvent 探针不当挂载
- hosted 不再把 `.wanxiangshu.ndjson` / `assistant_completed` 当插件挂载健康信号
- 包名 `agent-proctor`（CLI `proctor`）；资产协议 `papers-v1`
- `engines.node`：`>=22.22.0`；推荐 `.node-version` **24.18.0**
- promptfoo：Node 达标走标准 CLI，否则 main.js 回退

### Notes

- Plugin 假宿主：stubbed-ctx MVP 已开（`smoke-A-L2-plugin`）；不宣称 FakeHost ≡ 真 OpenCode / MCP 全真
- 真 Coordinator HTTP 最小面：`st-coordinator-e2e`（**已知失效**，万象术已无 PluginWanxiangzhen）
- 密钥轮换 / npm 公开发布需使用方操作
- CI 显式挂 `validate:product-eval`（无密钥）；product-eval 效果题扩至 16 对（+12～16：公开改编/启发自研）
- product-eval 配对题库 156 对 + 效果题 157–159（任务类型见 item `tags`）
