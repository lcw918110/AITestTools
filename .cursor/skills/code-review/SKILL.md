---
name: code-review
description: >-
  非琐碎改动 src 或 apps/console 后跑 Bugbot 代码审查。
  Use when finishing a coding slice, after self-check, or when the user says 审查 / review / bugbot.
---

> ⚠️ **基础约束：始终用简体中文回复。所有思考、对话、代码注释、报告都必须使用简体中文，不得使用英文。**

# 代码审查（本仓）

实现切片通过 `sdlc-self-check` 之后：**直接跑审查**（用户明确说跳过除外）。只改文档/题 JSON、无 `src/` 或 `apps/console` 代码时不必跑。

1. 读并遵守 Cursor 内置 `review-bugbot` skill（`~/.cursor/skills-cursor/review-bugbot/SKILL.md`）。
2. 默认 `Diff: uncommitted changes`（本仓工作区常有大量未提交资产；用户点名审分支/PR 时才用 `branch changes`）。
3. `Custom Instructions` 必须带上：

```text
不要建议改万象术业务逻辑。不要扩 papers-v1。156 全量不当效果结论。控制台文档口径以 docs/process/01-changelog.md 为准。
```

4. 跑完只汇总 findings 表，不自动改代码。用户说修再修。
5. 用户点名安全审查时改走内置 `review-security`，同样带上第 3 条说明。
