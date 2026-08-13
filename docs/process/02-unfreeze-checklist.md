# 实现解冻检查单（Phase 1）

| 字段     | 值                                                                  |
| :------- | :------------------------------------------------------------------ |
| 状态     | **切片 0–7 已通；Phase 1 DoD 已收口**（见 `20-phase1-dod-closure`） |
| 日期     | 2026-07-26                                                          |
| 前提     | 详细设计已过审（`00-final-review.md` + ADR-0001～0006）             |
| 解冻动作 | 用户已确认；ADR-0003 **已废止**；按下方切片编码                     |
| 过夜记录 | `docs/process/17-overnight-handoff-2026-07-26.md`                   |
| DoD 收口 | `docs/process/20-phase1-dod-closure-2026-07-26.md`                  |

确认记录：`同意解冻`（2026-07-25）。说明：设计终审此前已过审；本次确认的是**实现解冻**，不是补设计确认。

---

## 0. 解冻前只读核对（不改代码）

- [x] PRD v2 冻结可读
- [x] 提纲 v1.0、细化设计 10～15、02 RFP、终审已过审
- [x] 包名 `agent-proctor` / CLI `proctor` / 宿主 OpenCode **1.18.5** / 协议 **`papers-v1`**
- [x] 本清单一经确认，ADR-0003 标注为 **已废止（实现已解冻）**

---

## 1. 一次性工程改名与资产迁移（切片 0）

**目标**：脚手架与设计对齐，不引入新业务能力。

| #   | 项                                                        | 验收 |
| --- | --------------------------------------------------------- | ---- |
| 0.1 | `package.json`：`name=agent-proctor`，`bin.proctor`       | ✅   |
| 0.2 | schemas：`item`/`paperset`/`room`/`exam`                  | ✅   |
| 0.3 | `src/exam-engine` 考卷化                                  | ✅   |
| 0.4 | CLI：`item validate` + `case` 别名；`init` 产出 papers 树 | ✅   |
| 0.5 | `examples/` + `templates/` 迁 `papers-v1`                 | ✅   |
| 0.6 | 单测同步                                                  | ✅   |
| 0.7 | 根 README / CHANGELOG                                     | ✅   |

**对照 Phase 0**：`40-评测工具/harness/tools/case-validate.mjs` 行为用兼容测试钉住。

---

## 2. Phase 1 实现切片（有序）— 全部 ✅

| 切片 | 内容                       | 状态 |
| ---- | -------------------------- | ---- |
| 1    | exam-engine 完备           | ✅   |
| 2    | L1 fold + 三类 oracle      | ✅   |
| 3    | 契约 + fakehost + scripted | ✅   |
| 4    | `contract verify`          | ✅   |
| 5    | B-direct promptfoo spike   | ✅   |
| 6    | B-hosted smoke + 归因树    | ✅   |
| 7    | run / compare / baseline   | ✅   |

细节仍见历史章节；验收证据以 `20-phase1-dod-closure` 为准。

---

## 3. 明确不做（本解冻周期）

> 下表为**解冻当时**边界。C 轴 / L3 录制器已在 Phase 2 最小面落地（../22-phase2-outline.md 与本栏 23–27）；本表勿当「永久不做」。

| 项                             | 原因                      |
| ------------------------------ | ------------------------- |
| C 轴 shell 驱动                | Phase 2（**已最小面绿**） |
| L3 cassette 录制器             | Phase 2（**已最小面绿**） |
| LLM-judge 进门禁               | PRD 非目标                |
| 指标名 `a_case_pass_rate` 改名 | ADR-0006：Phase 1 暂留    |
| 归因标签改名 `HARNESS`         | 保留六选一集合            |

---

## 4. 质量门禁

```text
npm run verify
```

切片 7：同配置连续跑两次 A 轴，归一化 results 一致（`tests/cli/slice7-compare.test.ts`）。

---

## 5. 文档同步义务

每完成一切片：更新 `docs/README.md` 当前阶段。PRD §8 DoD 已勾选；**下一阶段入口为 Phase 2**，勿把万象术真对接算进 Phase 1。

---

## 6. 风险提醒

| 风险                       | 对策                                                           |
| -------------------------- | -------------------------------------------------------------- |
| 1.18 与旧 host-docs 不一致 | 以本机为准写契约 + verify                                      |
| Fold 接口漂移              | room `fold_entries` + `item migrate`                           |
| promptfoo 中立性           | 适配层隔离；可换 Inspect                                       |
| Node / promptfoo CLI       | ~~升级后去掉 main.js 绕过~~ → Node 24.18 已走标准 CLI（见 26） |

---

## 7. 确认栏

| 项                     | 选择                 |
| ---------------------- | -------------------- |
| 是否批准按本清单解冻？ | **是**（2026-07-25） |
| 是否从切片 0 开始？    | **是**               |
| 是否跳过某切片？       | **否**               |
| Phase 1 DoD 收口       | **是**（2026-07-26） |
