# 拍板落地记录（2026-07-26）

| 字段 | 值                                                             |
| :--- | :------------------------------------------------------------- |
| 依据 | 用户对 D1–D6 与「未完成」清单的拍板 + 美团 LongCat / DeepSeek  |
| 密钥 | 仅写入本地 `.env`（gitignore）；**聊天里已暴露，建议平台轮换** |
| 收口 | 见 [03-phase1-dod](../../process/03-phase1-dod.md)             |

---

## 拍板对照与落地

| 拍板                   | 落地                                                                                                     |
| ---------------------- | -------------------------------------------------------------------------------------------------------- |
| D1 假接口 + 万象术备注 | `control-flow-plugin.mjs` 顶部 `WANXIANGSHU_HOOKUP` 注释                                                 |
| D2 临时 probe 真跑     | `src/contract/verify/opencode-hook-probe.mjs` + `runtime-probe.ts`；`contract verify` **14 probes PASS** |
| D3 没真 API 不算完成   | LongCat + DeepSeek live；**2×5×3 = 30/30 PASS**（见 19）                                                 |
| D4 npm i promptfoo     | 已装 `promptfoo@0.121.19`；Node 22.16 → 经 `main.js` 绕过硬拦（记风险）                                  |
| D5 不隐藏问题          | hosted 无有效会话 → **FAIL + CONTEXT**；有可用模型 → PASS                                                |
| D6 指标/HARNESS 暂不改 | 保持                                                                                                     |

---

## 当前状态（收口后）

| 项           | 结果                                                                               |
| ------------ | ---------------------------------------------------------------------------------- |
| 美团 API     | B-direct + OpenCode hosted（全局默认 `meituan/LongCat-2.0`，key 已与 `.env` 同步） |
| DeepSeek     | 第二模型 `deepseek-v4-flash` live 绿                                               |
| probe 真触发 | event + chat.message                                                               |
| hosted 真测  | LongCat PASS；鉴权失败仍诚实红                                                     |
| 切片 7       | compare 三分类 + 重跑一致；`run_id` 防碰撞                                         |
| Phase 1 DoD  | **已勾选**（PRD §8 + 20）                                                          |

---

## 残留风险（不粉饰）— 历史快照；现状见 `26` 与 [01-changelog](../../process/01-changelog.md)

1. ~~**promptfoo CLI** 在 Node 22.16 需绕过 entrypoint~~ → 已用 Node **24.18** 走标准 bin（不达标仍保留 main.js 回退）。
2. **API Key 曾出现在聊天**：请平台轮换；勿提交 `.env`。
3. **未做 npm registry 公开发布**（本地 `dist` + `bin` 可用）。
4. ~~**万象术 / Phase 2** 未开始~~ → Phase 2 最小面已绿（见 `docs/design/01-phase-outline.md` §B）；ST 真 git e2e 另议。

---

## 复查命令

```bash
npm run verify
npm run proctor -- contract verify --host opencode@1.18.5
PROCTOR_PROMPTFOO_LIVE=1 MATRIX_SUBJECTS=LongCat-2.0,deepseek-v4-flash \
  npm run proctor -- run --axis B --paperset model-core --project examples/demo-project
npm run proctor -- run --axis B --paperset hosted-smoke --project examples/demo-project
```
