# demo-project — 示例考卷库

这是 `agent-proctor` 自带的**中性示例资产**（`papers-v1`），有两个用途：

1. 资产协议的可执行样板——照着它就能写出被引擎接受的试题 / 试卷 / 考场；
2. 引擎自身 CI 的校验夹具——`npm run validate:examples` 会跑它。

它**不是**任何真实被测项目的考卷。真实资产应留在被测仓库，用 `proctor item validate --project <路径>` 指向。

## 覆盖面

| 文件                                      | 演示什么                                                  |
| ----------------------------------------- | --------------------------------------------------------- |
| `items/A/todo-fold.item.json`             | A-L1：`fold_entry` 逻辑名 + `event_fold`/`no_event`       |
| `items/A/nudge-timing.item.json`          | A-L2：`contract` + `script` + 时序断言与 rev/`change_log` |
| `items/B/tool-schema-obedience.item.json` | B-direct：矩阵占位符、`repeats`、schema 服从              |
| `papersets/model-core.json`               | 门禁只挂 direct 指标                                      |
| `rooms/*.json`                            | 考场冻结；`fold` 考场含 `fold_entries`                    |
