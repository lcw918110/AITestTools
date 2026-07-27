# harness — Agent 评测工具（Phase 0 骨架）

需求文档：`../02-最终PRD.md`（唯一终稿 v2，附录含执行规格）。本目录为 Phase 0 落地骨架：用例资产 + suite/profile 定义 + 最小 `case validate`。Runner（Phase 1）尚未实现。

> 暂存说明：骨架当前暂存于 `systenstest/40-评测工具/harness/`，与工具文档同处一地；后续统一新建独立项目时整体迁出。

## 目录

```text
harness/
  cases/            # 用例资产：A 行为层 / B 模型层 / C 工具层
    A/*.case.json
    B/*.case.json
    C/*.case.json
  suites/           # 用例集合 + profile 绑定
  profiles/         # 环境冻结描述（fake-host / scripted-model / live-model / direct-tool）
  fixtures/         # 仓库快照、剧本、录制响应（按 case id 分目录）
  tools/
    case-validate.mjs   # 零依赖校验器（Node ≥ 18）
```

## Phase 0 格式决策

- 用例文件采用 **JSON**（`*.case.json`）：保证校验器零依赖可跑。规格中的 TOML 示例为逻辑字段说明；若后续引入 TOML 解析依赖，可平移格式，字段不变。
- 每个用例的 `id + rev` 与内容绑定：改 `stimulus` / `expect` 必须升 `rev`。

## 使用

```bash
# 校验全部用例（schema、freeze 完整性、禁裸 sleep、轴合法性）
node "systenstest/40-评测工具/harness/tools/case-validate.mjs"

# 校验单个文件
node "systenstest/40-评测工具/harness/tools/case-validate.mjs" "systenstest/40-评测工具/harness/cases/A/review-required-01.case.json"
```

## 三轴速记

| 轴 | 变化因子 | 冻结因子 | 主 Oracle |
| --- | --- | --- | --- |
| A 行为层 | 万象术类规则/流程 | 按层：L1 零模型直测 / L2 契约假宿主 + scripted / L3 cassette 对拍 | event_fold + state_predicate |
| B 模型层 | provider/model | Prompt 模板、工具契约、评分器 | 任务断言 + schema_obedience |
| C 工具层 | 工具实现 / args 边界 | 直调为主 | tool_result_equals + 副作用 |

A 轴按 PRD v2 分三层（`freeze.layer`）：

- **L1 事件直测**（主体）：import 被测 Fold 产物，喂事件序列断折叠态；`model_driver = "none"`。
- **L2 契约假宿主**：hook 时序 + 剧本模型；`freeze.contract` + `freeze.script` 必填。
- **L3 cassette 对拍**：每宿主版本少量全链路证据；`freeze.cassette` 必填。

失败归因标签（每条失败必打其一）：`PROTOCOL` / `CONTEXT` / `MODEL_SCHEMA` / `MODEL_TASK` / `TOOL` / `HARNESS`。
