# Phase 1 细化设计 · 终审清单

| 字段 | 值                                    |
| :--- | :------------------------------------ |
| 日期 | 2026-07-25                            |
| 状态 | **已过审**                            |
| 包名 | `agent-proctor`（CLI 建议 `proctor`） |

---

## A. 文档清单

| 文档                                                                     | 主题                 | 状态           |
| ------------------------------------------------------------------------ | -------------------- | -------------- |
| [03-fold-entry-contract.md](../design/03-fold-entry-contract.md)         | L1 Fold 多入口       | **已确认**     |
| [04-state-predicate.md](../design/04-state-predicate.md)                 | 状态谓词表达式       | **已确认**     |
| [05-scripted-model.md](../design/05-scripted-model.md)                   | L2 剧本语法          | **已确认**     |
| [06-host-contract-schema.md](../design/06-host-contract-schema.md)       | OpenCode 契约 schema | **已确认**     |
| [07-hosted-attribution-tree.md](../design/07-hosted-attribution-tree.md) | hosted 归因树 v1     | **已确认**     |
| [02 RFP（已归档）](../archive/design/02-b-direct-framework-rfp.md)       | B-direct 框架评审    | **→ ADR-0007** |
| [02-protocol-papers-v1.md](../design/02-protocol-papers-v1.md)           | 协议全考卷化字段     | **已确认**     |
| [01-phase-outline.md](../design/01-phase-outline.md)                     | Phase 1+2 合并提纲   | 历史入口       |

---

## B. 与 PRD 的有意偏差（已知情同意）

| #   | 偏差                                       | 状态                         |
| --- | ------------------------------------------ | ---------------------------- |
| B1  | fold_entry 逻辑名                          | 同意                         |
| B2  | OpenCode 1.18.5                            | 同意                         |
| B3  | CLI `proctor`                              | 同意                         |
| B4  | 目录 **且** JSON 协议考卷化（`papers-v1`） | 同意（终审推翻「字段暂留」） |
| B5  | 归因树显式 TOOL                            | 同意                         |
| B6  | promptfoo 先 spike 再锁                    | 同意                         |

---

## C. 残留点决议

| #   | 你的决定                      | 落盘                 |
| --- | ----------------------------- | -------------------- |
| 1   | 同意 promptfoo spike          | ADR-0006 C1          |
| 2   | Fold 默认 json_clone          | ADR-0006 C2；设计 11 |
| 3   | **不接受**字段暂留 → 全考卷化 | ADR-0006 C3；设计 15 |
| 4   | 引擎对照本机 1.18.5           | ADR-0006 C4；设计 10 |

---

## D. 下一步

1. ~~输出实现解冻检查单~~ → [`02-unfreeze-checklist.md`](./02-unfreeze-checklist.md)
2. **你确认解冻**后：废止 ADR-0003 冻结，从 **切片 0**（改名 + `papers-v1` 迁移）起编码。
