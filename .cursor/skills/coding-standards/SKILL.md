---
name: coding-standards
description: >-
  TypeScript/ESLint/Prettier 与本仓写法：type import、strict、不顺手重构。
  Use when editing .ts/.js in this repo (src, apps/console, tests).
paths: '**/*.ts,**/*.js'
---

> ⚠️ **基础约束：始终用简体中文回复。所有思考、对话、代码注释、报告都必须使用简体中文，不得使用英文。**

# 编码规范（本仓）

权威在配置，不另发明风格：`eslint.config.js`、`tsconfig.json`、`.prettierrc.json`。

- ESM / `NodeNext`；`verbatimModuleSyntax`：值用普通 import，类型用 `import type`
- `strict`、`exactOptionalPropertyTypes`、`eqeqeq`；未用变量前缀 `_`
- `no-console`：默认 error；`src/cli`、`src/report`、`apps/console/**/*.ts` 允许
- 不改 `examples/` 里题库 JSON 的风格去「统一格式」，除非任务就是改那些文件
- 不改万象术仓业务逻辑；不扩 papers-v1 协议除非任务明确要求
- 只改任务需要的文件；不顺手重构、不搭新抽象
- 新行为配相关 `tests/`；UI 改动走 `sdlc-self-check` 的 console 项
