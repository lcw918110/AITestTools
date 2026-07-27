# ADR-0007：B-direct 默认适配器（promptfoo）

| 字段 | 值                                                       |
| :--- | :------------------------------------------------------- |
| 状态 | **已采纳（live：LongCat + DeepSeek，2×5×3=30/30）**      |
| 日期 | 2026-07-26                                               |
| 依据 | ADR-0004、ADR-0006 C1；用户拍板 D3/D4；DeepSeek 第二模型 |

## 决策

1. **依赖**：已 `npm i promptfoo`（当前 `0.121.19`）。
2. **双模式**：
   - `fixture`：默认 / CI（`PROCTOR_PROMPTFOO_LIVE` 非 `1`）
   - `live`：`PROCTOR_PROMPTFOO_LIVE=1` + 分模型密钥（见下）
3. **多 provider**：
   - `LongCat-*` → `LONGCAT_API_KEY` / `OPENAI_*`，`tool_choice=required`
   - `deepseek-*` → `DEEPSEEK_API_KEY` / `DEEPSEEK_BASE_URL`（默认 `https://api.deepseek.com`），`tool_choice=auto`（thinking 不支持 required）
4. **Node engines**：promptfoo 要求 `^20.20 \|\| >=22.22`。达标（含本仓推荐的 **24.18**）走标准 `.bin/promptfoo`；仅不达标时回退 `dist/src/main.js`（历史：本机曾用 22.16）。
5. **模型数**：live 验收 **`LongCat-2.0` + `deepseek-v4-flash`，2×5×3=30**（满足 PRD「2 模型」字面）。DeepSeek 官方当前模型名为 `deepseek-v4-flash` / `deepseek-v4-pro`，不是 `deepseek-chat`。
6. 门禁只看收编后的 `b_*` / oracle，不看 promptfoo 专有字段。

## 后果

- 正面：真 API 双模型管道已通；CI 仍可不耗额度。
- 负面：不达标 Node 仍有 main.js 回退；hosted 依赖本机 OpenCode 已鉴权模型（见 docs/process/19-deepseek-and-hosted-auth-2026-07-26.md）。

## 相关

- `src/drivers/model-adapter/promptfoo.ts`
- `docs/process/18-decisions-landed-2026-07-26.md`
- `docs/process/19-deepseek-and-hosted-auth-2026-07-26.md`
