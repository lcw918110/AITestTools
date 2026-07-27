# 文档索引

本仓库文档按软件工程阶段分栏。需求终稿在 `40-评测工具/`；详细设计与 ADR 在本目录。

## 需求（只读输入）

| 文档                                                        | 说明                                  |
| ----------------------------------------------------------- | ------------------------------------- |
| [`40-评测工具/02-最终PRD.md`](../40-评测工具/02-最终PRD.md) | 产品需求终稿 v2（已冻结）             |
| [`40-评测工具/README.md`](../40-评测工具/README.md)         | 资料目录说明                          |
| [`40-评测工具/harness/`](../40-评测工具/harness/)           | Phase 0 资产与临时校验器（历史/对照） |

## 架构决策（ADR）

| 编号                                          | 标题                                                          | 状态                     |
| --------------------------------------------- | ------------------------------------------------------------- | ------------------------ |
| [0001](adr/0001-tech-stack.md)                | 技术栈（TS / npm / Vitest）                                   | 已采纳                   |
| [0002](adr/0002-repo-layout-and-assets.md)    | 单包形态与资产归属                                            | 已采纳                   |
| [0003](adr/0003-scaffold-freeze.md)           | 抢跑脚手架冻结                                                | **已废止（实现已解冻）** |
| [0004](adr/0004-b-direct-adapter-strategy.md) | B-direct 可换框架适配策略                                     | 已采纳（具体框架待评审） |
| [0005](adr/0005-naming-host-fold.md)          | 考卷隐喻、`agent-proctor`、OpenCode 1.18.5、Fold 多入口       | 已采纳                   |
| [0006](adr/0006-final-review-decisions.md)    | 终审：promptfoo spike、json_clone、协议全考卷化、契约对照本机 | 已采纳                   |
| [0007](adr/0007-promptfoo-spike-fixture.md)   | B-direct：promptfoo；LongCat+DeepSeek live 2×5×3              | **已采纳**               |

## 详细设计

| 文档                                                                                              | 说明                             | 状态                     |
| ------------------------------------------------------------------------------------------------- | -------------------------------- | ------------------------ |
| [01-phase1-outline.md](design/01-phase1-outline.md)                                               | Phase 1 详细设计提纲             | **v1.0 已确认**          |
| [00-final-review.md](design/00-final-review.md)                                                   | 终审清单                         | **已过审**               |
| [15-protocol-papers-v1.md](design/15-protocol-papers-v1.md)                                       | 资产协议 papers-v1 字段          | **已确认**               |
| [16-unfreeze-checklist.md](design/16-unfreeze-checklist.md)                                       | 实现解冻检查单                   | **已解冻；DoD 已收口**   |
| [17-overnight-handoff-2026-07-26.md](design/17-overnight-handoff-2026-07-26.md)                   | 过夜 1→3→2→4 推进记录与决策      | 历史                     |
| [18-decisions-landed-2026-07-26.md](design/18-decisions-landed-2026-07-26.md)                     | 拍板 D1–D6 落地                  | 历史                     |
| [19-deepseek-and-hosted-auth-2026-07-26.md](design/19-deepseek-and-hosted-auth-2026-07-26.md)     | DeepSeek + OpenCode 鉴权         | 历史                     |
| [20-phase1-dod-closure-2026-07-26.md](design/20-phase1-dod-closure-2026-07-26.md)                 | Phase 1 DoD 收口对照             | **必读**                 |
| [21-wanxiangshu-hookup-2026-07-26.md](design/21-wanxiangshu-hookup-2026-07-26.md)                 | 万象术 L1/L2/hosted 接入         | **已通**（见 23/26）     |
| [22-phase2-outline.md](design/22-phase2-outline.md)                                               | Phase 2 提纲与最小面             | **最小面绿；未整体完成** |
| [23-autonomous-run-2026-07-26.md](design/23-autonomous-run-2026-07-26.md)                         | 自主推进过程记录与停点           | **必读**                 |
| [24-st-import-l1-2026-07-26.md](design/24-st-import-l1-2026-07-26.md)                             | ST-\* → L1 导入 ≥10              | **12/12 PASS**           |
| [25-opencode-cassette-recorder-2026-07-27.md](design/25-opencode-cassette-recorder-2026-07-27.md) | OpenCode→cassette 录制面         | **最小面绿**             |
| [26-live-selftest-and-node-2026-07-27.md](design/26-live-selftest-and-node-2026-07-27.md)         | live 自测 + Node 版本说明        | **必读**                 |
| [27-autonomous-continue-2026-07-27.md](design/27-autonomous-continue-2026-07-27.md)               | gates / 并发 / report trend      | **必读**                 |
| [28-ops-path-npm-st-2026-07-27.md](design/28-ops-path-npm-st-2026-07-27.md)                       | PATH / npm / ST 真 git 收口      | **必读**                 |
| [11-fold-entry-contract.md](design/11-fold-entry-contract.md)                                     | L1 Fold 入口约定                 | **已确认**               |
| [14-state-predicate.md](design/14-state-predicate.md)                                             | state_predicate 表达式子集       | **已确认**               |
| [13-scripted-model.md](design/13-scripted-model.md)                                               | 剧本模型语法                     | **已确认**               |
| [10-host-contract-schema.md](design/10-host-contract-schema.md)                                   | 宿主契约 schema（OpenCode 1.18） | **已确认**               |
| [12-hosted-attribution-tree.md](design/12-hosted-attribution-tree.md)                             | hosted 归因判定树 v1             | **已确认**               |
| [02-b-direct-framework-rfp.md](design/02-b-direct-framework-rfp.md)                               | B-direct：spike=promptfoo        | fixture 通；见 ADR-0007  |

## 当前阶段

**见 [28-ops-path](design/28-ops-path-npm-st-2026-07-27.md)。**  
节奏：**先 Git 开源** → 本地/社区验证后再定对外形态（npm 暂缓）。PATH 已钉 24.18；ST 最小面绿；密钥轮换仍需你。
