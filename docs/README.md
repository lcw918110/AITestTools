# 文档索引（按阅读顺序）

业务阅读顺序：**仓库地图 → 需求 → 架构 → 设计 → 开发/验收 → 测试**。

| 序    | 阶段      | 路径                                           | 说明                                     |
| :---- | :-------- | :--------------------------------------------- | :--------------------------------------- |
| **0** | 地图      | [`00-repo-structure.md`](00-repo-structure.md) | 各目录与文档作用                         |
| **1** | 需求      | [`requirements/`](requirements/)               | **`00` 术语（唯一实体）** · `01` PRD · `02` 操作台 · `03` 题库 |
| **2** | 架构      | [`architecture/adr/`](architecture/)           | ADR `0001`～`0008`                       |
| **3** | 设计      | [`design/`](design/)                           | `01`～`09`（含题库工作台）               |
| **4** | 开发/验收 | [`process/`](process/)                         | **01 过程日志（当前态）**；02～04 关闭的门禁 |
| **5** | 测试      | [`test/`](test/)                               | `01` 三对象 · `02` 引擎 · `03` 操作台    |
| —     | 归档      | [`archive/`](archive/)                         | 不进日常阅读                             |

## 设计栏阅读序（3.x）

| 序  | 文件                                                                  |
| :-- | :-------------------------------------------------------------------- |
| 01  | [01-phase-outline.md](design/01-phase-outline.md)                     |
| 02  | [02-protocol-papers-v1.md](design/02-protocol-papers-v1.md)           |
| 03  | [03-fold-entry-contract.md](design/03-fold-entry-contract.md)         |
| 04  | [04-state-predicate.md](design/04-state-predicate.md)                 |
| 05  | [05-scripted-model.md](design/05-scripted-model.md)                   |
| 06  | [06-host-contract-schema.md](design/06-host-contract-schema.md)       |
| 07  | [07-hosted-attribution-tree.md](design/07-hosted-attribution-tree.md) |
| 08  | [08-console-outline.md](design/08-console-outline.md)                 |

## 日常入口

| 你要…          | 打开                                                                       |
| :------------- | :------------------------------------------------------------------------- |
| 名词是什么     | [requirements/00-glossary.md](requirements/00-glossary.md)             |
| 仓库有什么     | [00-repo-structure.md](00-repo-structure.md)                               |
| 产品要什么     | [requirements/01-prd.md](requirements/01-prd.md)                           |
| **测万象术**   | **[test/01-wanxiangshu-ops.md](test/01-wanxiangshu-ops.md)**               |
| **本地操作台** | `npm run console`；测法见 [test/03-console-ops.md](test/03-console-ops.md) |

## 当前约定

- Git 开源；npm 暂缓
- 效果考卷：`examples/product-eval/`
- 回归题库副本：`examples/wanxiangshu-papers/`（`SUT_ROOT` 指被测仓）
- Phase 0 历史样例：`tests/fixtures/legacy-phase0/`（`40-评测工具/` 已移除）
