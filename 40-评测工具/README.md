# 评测工具资料

本目录存放「Agent 评测工具」的产品需求与后续设计实现文档。

与上级目录中手工系统测试流程的关系：

- `01` / `02` / `20` / `30`：人读场景、批次、执行记录
- 本目录：机器可跑的 harness 需求（三轴、用例版本、指标、CLI）

当前文件：

- `02-最终PRD.md`：**唯一需求文档（终稿 v2）**。架构评审后修订：A 轴三层（事件直测 ≫ 契约假宿主 > cassette 对拍）、B 轴 direct 适配成熟评测框架、hosted 轨迹归因；引擎独立 npm 包、C 轴 CLI 壳二期、Phase 1 = A+B；附录含用例更新铁律、Oracle 目录、指标目录、CLI/产物契约、术语表（原 `01-需求规格.md` 底稿已并入附录后删除，历史见 git）

已落地的 Phase 0 骨架（暂存于本目录 `harness/`，后续统一新建独立项目时整体迁出）：

- `harness/cases/{A,B,C}/`：三轴样例用例各 1（`*.case.json`，含 rev / freeze / oracles / metrics）
- `harness/suites/`：`smoke-A` / `model-core` / `tool-core`（含指标门禁阈值）
- `harness/profiles/`：`fake-host-v1` / `live-model-v1` / `direct-tool-v1`
- `harness/tools/case-validate.mjs`：零依赖校验器；`node "systenstest/40-评测工具/harness/tools/case-validate.mjs"` 全绿，坏用例可拦截并退出码 1
