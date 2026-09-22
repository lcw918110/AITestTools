# ADR-0006：终审残留决议（框架 spike / normalize / 协议全考卷化 / 契约对照源）

| 字段   | 值                         |
| :----- | :------------------------- |
| 状态   | **已采纳**                 |
| 日期   | 2026-07-25                 |
| 决策人 | 用户拍板（终审清单 C1–C4） |

## 决策

| #   | 决议                                                                                           |
| --- | ---------------------------------------------------------------------------------------------- |
| C1  | B-direct：**先 promptfoo spike**，通过后另立 ADR 锁定默认 adapter；Inspect 仅保留接口位        |
| C2  | Fold 返回值：**默认 `normalize: "json_clone"`**（room entry 可改 `none`）                      |
| C3  | **不接受**「目录考卷化、字段仍 case/suite」→ **目录与 JSON 协议字段一并考卷化**                |
| C4  | OpenCode 契约正文：**引擎侧对照本机 1.18.5** 钉死；host-docs 1.17 仅作历史参考，不作文档权威源 |

## C3 协议字段对照（PRD / Phase 0 → 新协议）

| 旧（PRD / 脚手架）              | 新（agent-proctor）                             | 说明                                               |
| ------------------------------- | ----------------------------------------------- | -------------------------------------------------- |
| `harness.json`                  | `exam.json`                                     | 考卷库清单                                         |
| `cases/` · `*.case.json`        | `items/` · `*.item.json`                        | 试题文件                                           |
| 字段 `id`（用例号）             | 仍用 `id`（试题号，格式不变）                   | 避免无意义加长                                     |
| 文档/结果里的 `case_id`         | `item_id`                                       | run 产物                                           |
| `case_rev`                      | `item_rev`                                      |                                                    |
| `suites/`                       | `papersets/`                                    | 试卷目录                                           |
| suite 文档 `name` / `cases: []` | `name` / `items: []`                            | 试卷引用试题 id 列表                               |
| `profiles/`                     | `rooms/`                                        | 考场                                               |
| `fixtures/`                     | `materials/`                                    | 考材                                               |
| CLI `case validate`             | `item validate`（可保留 `case` 为隐藏别名一期） | 人读命令考卷化                                     |
| 归因兜底标签名 `HARNESS`        | **保留** `HARNESS`                              | 六选一标签是失败分类，不是产品名；改名成本高且易混 |

> `axis` / `freeze` / `oracle` / `stimulus` 等无「考卷对立词」的术语 **保留**（行业通用；定义见 [术语篇](../../requirements/00-glossary.md)）。

资产协议版本：`exam.json` 中 `asset_protocol` 取 **`papers-v1`**，与旧 `harness` 协议不混读；Phase 0 资产需迁移工具或一次性改写（解冻检查单列出）。

## 后果

- 实现解冻时 schemas、examples、CLI、run 产物字段按上表改齐。
- PRD 仍是需求权威；本 ADR 记录「人读/协议命名」产品化修订。
- 契约文件以本机 `opencode@1.18.5` 行为为准做 verify，不阻塞于 host-docs 是否已升版。

## 相关

- `docs/process/04-final-review.md`
- `docs/design/02-protocol-papers-v1.md`（字段级清单）
- ADR-0004、0005；设计 02 / 10 / 11
