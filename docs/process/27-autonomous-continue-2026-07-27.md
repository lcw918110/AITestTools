# 自主续跑收口（2026-07-27）

| 字段   | 值                                                           |
| :----- | :----------------------------------------------------------- |
| Node   | **24.18.0**（`.node-version` + `PATH=/usr/local/bin:$PATH`） |
| verify | 见本轮回归                                                   |

---

## 本轮落地

| 项                                                             | 结果                           |
| :------------------------------------------------------------- | :----------------------------- |
| paperset `gates` → `metrics.json` + 退出码                     | 已实现                         |
| `--concurrency N`                                              | 已实现                         |
| `metric_threshold`                                             | L1 / L2 / B-direct / C         |
| `tool_side_effect` / `workspace_assert` / `tool_result_equals` | C 轴已接；demo echo/write 已挂 |
| `proctor report trend`                                         | 多 run 指标时间线              |
| hosted NDJSON 竞态短等                                         | 已修；hosted-smoke PASS        |
| 文档 16/18/20/22–27、README                                    | 历史快照已标注                 |

## 回归（Node 24.18）

- smoke-A-L1（concurrency=4）5/5 + gates PASS
- smoke-A-L3 6/6 + gates PASS
- model-core fixture + gates PASS
- st-import-L1 12/12 + gates PASS
- hosted-smoke PASS（短等轮询后）
- smoke-C-echo / smoke-C-write（含新 oracle）

## 仍需你

- 平台密钥轮换；npm 公开发布
- 默认 shell PATH 若仍指向 22.16，自行优先 `/usr/local/bin`
- ST-06/09/12/14/16 真 git e2e
