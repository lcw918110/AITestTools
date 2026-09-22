---
name: sdlc-self-check
description: >-
  宣称完成前必须做目标对齐与可证伪自测；未通过不得说已交付。
  Use when finishing any implementation, doc, or asset change in this repo,
  or before saying 完成 / 已落地 / 已验收.
---

# 完成前自测（本仓）

源自全局规则「完成前自测」，补上本仓门禁。Grill 对齐并实现之后、对用户说完成之前，必须走本 skill。

## 1. 目标对齐（先于自测）

对照用户原话和已确认计划逐条勾：交付物、范围、不做的事、成功标准。缺一条就补，禁止用邻近成果顶替原目标。

## 2. 自测（按改动选）

禁止只靠「看起来没问题」。有脚本先跑；没有就当场做最小检查。

| 改了什么 | 至少做 |
| :------- | :----- |
| `src/` / `apps/console/*.ts` / 测试 | 相关 `vitest`；改 TypeScript 再 `npm run typecheck`；能跑则 `npm run lint` |
| `apps/console/` UI | `npm run console:smoke`；有浏览器工具则走主路径点一遍 |
| `examples/product-eval` 题/组卷 | `npm run validate:product-eval` |
| 文档 | 链接能解析、术语与过程日志一致、不留两套口径 |
| 纯问答 | 用原问题复核；引用的路径须存在或已执行 |

沙箱里 `git init` 失败时，用足够权限重跑该条，不要把沙箱失败写成产品失败。

## 3. 未通过

先修再测，直到通过，或写明剩余缺口与影响（不得把失败说成完成）。

```text
❌ 改完就说「做好了」
✅ 对齐目标 → 跑测试/脚本或抽查 → 失败则修 → 通过后才交付
```

收口写清：对齐了什么、测了什么、通过/失败。

## 4. 代码审查

改了 `src/` 或 `apps/console/` 且非琐碎：自测通过后**必须**走本仓 `code-review`（用户说跳过除外）。只改文档或题 JSON 不必跑。
