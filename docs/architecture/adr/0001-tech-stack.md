# ADR-0001：技术栈

| 字段   | 值                       |
| :----- | :----------------------- |
| 状态   | **已采纳**               |
| 日期   | 2026-07-25               |
| 决策人 | 项目初始化（按推荐默认） |

## 背景

引擎需以独立 Node npm 包形态交付（PRD D1），并支持 CLI、可测模块、后续适配外部评测框架。

## 决策

- 语言：**TypeScript**（ESM，`"type": "module"`）
- 运行时：**Node ≥ 22.22.0**（推荐 24.18；见仓库 `.node-version`）
- 包管理：**npm**
- 构建：`tsc`（`tsconfig.build.json` 产出 `dist/`）
- 单测：**Vitest**
- Lint/格式：ESLint 9 flat config + Prettier

## 后果

- 正面：类型安全、与 PRD「Node/TS 包」一致、生态与招聘成本低。
- 负面：需编译步骤；开发期可用 `node --experimental-strip-types` 跑 CLI 源码。
- 不做：不引入 Bun 作为主运行时；不采用纯 JS 零构建方案。

## 相关

- PRD §3、§7 Phase 1 序 1
