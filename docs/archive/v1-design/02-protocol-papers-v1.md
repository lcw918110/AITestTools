# 15 · 资产协议 `papers-v1` 字段清单

| 字段 | 值                                                  |
| :--- | :-------------------------------------------------- |
| 状态 | **已确认**（随 ADR-0006 C3）                        |
| 日期 | 2026-07-25                                          |
| 依据 | ADR-0005、ADR-0006；PRD 附录 D 产物形状的考卷化映射 |

---

## 1. 考卷库根 `exam.json`

```json
{
  "name": "wanxiangshu-papers",
  "asset_protocol": "papers-v1",
  "engine": { "min_version": "0.1.0" },
  "system_under_test": { "name": "wanxiangshu", "root_env": "SUT_ROOT" },
  "paths": {
    "items": "items",
    "papersets": "papersets",
    "rooms": "rooms",
    "materials": "materials",
    "scripts": "scripts",
    "cassettes": "cassettes",
    "runs": "runs"
  },
  "defaults": { "paperset": "smoke-A", "room": "fold-wanxiangshu-v1" }
}
```

---

## 2. 试题 `*.item.json` 关键字段名

相对 PRD `*.case.json`：**结构不变**，仅文件扩展名与目录变更；顶层仍为 `id` `rev` `axis` `status` `title` `intent` `freeze` `stimulus` `expect` `metrics` `execution`。

`stimulus.ref` / oracle `spec` 路径改指向 `materials/...`。

---

## 3. 试卷 `papersets/*.json`

```json
{
  "name": "smoke-A",
  "axis": "A",
  "room": "fold-wanxiangshu-v1",
  "gates": { "a_case_pass_rate": { "min": 1.0 } },
  "items": ["A-REVIEW-REQUIRED-01"]
}
```

| 旧字段    | 新字段  |
| --------- | ------- |
| `profile` | `room`  |
| `cases`   | `items` |

指标名（如 `a_case_pass_rate`）Phase 1 **暂保留** PRD 目录名，避免指标历史断档；人读报告可显示「试题通过率」。是否在 Phase 2 改名另议。

---

## 4. Run 产物字段

| 旧                                         | 新                     |
| ------------------------------------------ | ---------------------- |
| `results.ndjson` 内 `case_id` / `case_rev` | `item_id` / `item_rev` |
| `run.json` 的 case 列表                    | `items: [{ id, rev }]` |
| 报告文案 “case”                            | “试题 / item”          |

---

## 5. CLI（解冻后）

```text
proctor item validate [--project <papers根>] [file...]
proctor run --axis A --paperset smoke-A
proctor contract verify --host opencode@1.18.5
proctor compare ...
proctor baseline pin ...
proctor report show ...
```

一期可隐藏别名：`case`→`item`，`suite`→`paperset`，减少手指记忆负担；帮助文案以考卷词为准。

---

## 6. 与 PRD 关系

需求行为以 PRD 为准；**命名层**以 ADR-0006 + 本文为准。文档与代码注释写「PRD 所称 case = 本协议 item」。
