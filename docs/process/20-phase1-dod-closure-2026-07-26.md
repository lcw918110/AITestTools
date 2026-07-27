# Phase 1 DoD 收口记录（2026-07-26）

| 字段 | 值                                                               |
| :--- | :--------------------------------------------------------------- |
| 依据 | PRD §7 序 1–7 + §8 验收清单；用户「自主决策模式」                |
| 结论 | **Phase 1 实现 DoD 可勾选通过**（证据见下）；非 npm 公开发布完成 |

---

## PRD §8 对照

| DoD 项                                 | 结论     | 证据                                                                                          |
| -------------------------------------- | -------- | --------------------------------------------------------------------------------------------- |
| 引擎独立包可运行，不依赖被测仓库构建链 | **通过** | `npm run proctor` / `npm run build` → `node dist/cli/main.js`；考卷在 `examples/demo-project` |
| L1：Fold 直测 ≥5                       | **通过** | `smoke-A-L1` 5/5；切片 7 重跑归一化一致                                                       |
| L2：假宿主 + 剧本 ≥2                   | **通过** | `smoke-A` nudge + review                                                                      |
| `contract verify` 真宿主通过并留档     | **通过** | `runs/contract-verify/2026-07-25T23-34-05-410Z`，**14 probes PASS**                           |
| B-direct：2 模型完整矩阵               | **通过** | LongCat + deepseek-v4-flash，**2×5×3=30/30**（19）                                            |
| B-hosted：归因分诊，无「无归因红灯」   | **通过** | 缺鉴权 → FAIL+CONTEXT；有模型 → PASS（LongCat）                                               |
| hosted 指标无法配置为 gate             | **通过** | `GATE_NOT_ALLOWED` 单测 + broken-project                                                      |
| `compare` 三分类；同 rev 重跑一致      | **通过** | `tests/cli/slice7-compare.test.ts`；new_failure/fixed/asset_rev_drift                         |
| 默认 suite 无网络；需网显式标注        | **通过** | A 轴 fold/fakehost 离线；B live/hosted `network: true`                                        |

---

## 本轮工程修补

1. **`run_id` 碰撞**：原秒级时间戳同秒覆盖；改为 `…sssmss-xxxx`（毫秒+随机后缀）。
2. **compare**：补 `asset_rev_drift` 单测 + CLI 三分类集成测。
3. **重跑一致性**：smoke-A 连续两次归一化 `results.ndjson`（剔除 `artifact_dir`）字节一致 → compare 全 `unchanged`。

---

## 仍非「产品发布完成」的项

| 项                                 | 说明                             |
| ---------------------------------- | -------------------------------- |
| npm 公开发布 / `npx agent-proctor` | 包可 build，未做 registry 发布   |
| 密钥轮换                           | 聊天曾暴露 LongCat/DeepSeek key  |
| ST 真 git e2e                      | ST-06/09/12/14/16 仍需真宿主/git |

> **后续进展（非本页收口范围）**：Node **24.18** 已切、走标准 promptfoo CLI；万象术 L1/hosted/ST-L1 与 Phase 2 最小面见 23–27。本表「Node 绕过 / Phase 2 未做」为 2026-07-26 当时快照，勿当现状。

---

## 复查命令

```bash
npm run verify
npm run proctor -- contract verify --host opencode@1.18.5
npm run proctor -- run --axis A --paperset smoke-A-L1 --project examples/demo-project
npm run proctor -- run --axis A --paperset smoke-A --project examples/demo-project
PROCTOR_PROMPTFOO_LIVE=1 MATRIX_SUBJECTS=LongCat-2.0,deepseek-v4-flash \
  npm run proctor -- run --axis B --paperset model-core --project examples/demo-project
npm run proctor -- run --axis B --paperset hosted-smoke --project examples/demo-project
```
