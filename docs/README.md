# 文档索引

按软件工程阶段分栏。开源仓：https://github.com/lcw918110/AITestTools

| 栏       | 路径                             | 内容                      |
| :------- | :------------------------------- | :------------------------ |
| **需求** | [`requirements/`](requirements/) | PRD 入口（冻结需求）      |
| **架构** | [`architecture/`](architecture/) | ADR 决策记录              |
| **设计** | [`design/`](design/)             | 协议 / Phase 提纲 / 规格  |
| **过程** | [`process/`](process/)           | DoD、自测、推进与运维日志 |

## 快速入口

| 想看…                      | 去                                                                                                                      |
| :------------------------- | :---------------------------------------------------------------------------------------------------------------------- |
| 产品要什么                 | [requirements](requirements/) → PRD                                                                                     |
| 为何这样拆仓/题库          | [ADR-0002](architecture/adr/0002-repo-layout-and-assets.md)、[ADR-0008](architecture/adr/0008-local-sut-papers-copy.md) |
| papers-v1 / Fold / hosted  | [design](design/)                                                                                                       |
| Phase 1 是否收口、开源节奏 | [process/20](process/20-phase1-dod-closure-2026-07-26.md)、[process/28](process/28-ops-path-npm-st-2026-07-27.md)       |

## 当前约定

- 对外节奏：**Git 开源 → 验证后再定 npm 等形态**（npm 暂缓）
- 万象术题库：**本仓副本** `examples/wanxiangshu-papers/`；运行时 `--project` 指本地副本；`SUT_ROOT` 仍指向被测仓根（Fold/Plugin 构建产物）
