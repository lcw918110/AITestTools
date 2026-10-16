---
name: design-current-state
description: >-
  改产品或架构前先改现行需求/设计/测试/过程日志，只留当前态。
  Use when changing console/bank/eval behavior, papers-v1 usage, rooms/papersets, or docs in this repo.
paths: docs/**/*.md,examples/product-eval/**/*.md
---

> ⚠️ **基础约束：始终用简体中文回复。所有思考、对话、代码注释、报告都必须使用简体中文，不得使用英文。**

# 设计落盘（本仓）

Grill 达成共识之后、写实现之前（或与实现同一切片但**先改文档**）：

1. 改**现行**正文，不新开一份「v2 过程日记」与旧口径并存。
2. 按改动选文件（缺哪改哪，不要四篇都空改）：
   - 操作台产品：`docs/archive/v1-requirements/02-console-prd.md`、`docs/archive/v1-design/08-console-outline.md`、`docs/test/03-console-ops.md`
   - 题库录入：`docs/archive/v1-requirements/03-bank-editor-prd.md`、`docs/archive/v1-design/09-bank-editor.md`
   - 三对象跑法：`docs/test/01-wanxiangshu-ops.md`
   - 打开的任务/口径：`docs/process/01-changelog.md`（**不是**功能任务表里再加一条 skill）
   - V2.17 新需求/设计/架构/界面/实验：`docs/01-产品需求规格说明书.md`、`docs/02-总体架构与领域设计.md`、`docs/03-界面与交互设计.md`、`docs/04-首期实验方案与用例治理.md`
3. 架构取舍（协议、考场、归因）才写或改 `docs/architecture/adr/`。
4. 旧说法删除或改写，历史只留 git。

禁止：文档写一套、代码另一套；把 156 全量写成效果结论。
