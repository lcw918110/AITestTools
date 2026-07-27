# DeepSeek 第二模型 + OpenCode hosted 鉴权（2026-07-26）

| 字段 | 值                                                                    |
| :--- | :-------------------------------------------------------------------- |
| 依据 | 用户提供 DeepSeek Key；要求具体说明修鉴权；测试/中间过程不降级        |
| 密钥 | 仅 `.env`（gitignore）；**聊天已暴露 LongCat + DeepSeek，请平台轮换** |

---

## 1. DeepSeek 接入（B-direct，满足「2 模型」字面）

| 项         | 结论                                                                                             |
| ---------- | ------------------------------------------------------------------------------------------------ |
| Base       | `https://api.deepseek.com`                                                                       |
| 可用模型名 | **`deepseek-v4-flash` / `deepseek-v4-pro`**（`deepseek-chat` 已被拒）                            |
| 工具调用   | thinking 模式 **不支持 `tool_choice=required`** → 适配器对 deepseek-* 用 **`auto`**              |
| 代码       | `src/drivers/model-adapter/promptfoo.ts` 按模型解析 provider（LongCat / DeepSeek 分密钥与 base） |
| 矩阵       | `MATRIX_SUBJECTS=LongCat-2.0,deepseek-v4-flash` → **2×5×3**                                      |

```bash
PROCTOR_PROMPTFOO_LIVE=1 MATRIX_SUBJECTS=LongCat-2.0,deepseek-v4-flash \
  npm run proctor -- run --axis B --paperset model-core --project examples/demo-project
```

---

## 2. 如何修 OpenCode hosted 鉴权（具体步骤）

### 根因（本机实测）

`opencode run` **未带 `-m` 时**走默认 agent **`build`**，其模型为：

`omniroute-ai/qwen3.7-plus`

该 provider 未有效鉴权 → **Unauthorized**。  
即便改用 `meituan/LongCat-2.0`，本机还曾报 **Token 额度不足**（属额度，不是引擎吞错）。

### 修法 A：评测侧显式指定模型（推荐，已落地）

1. 在考场或环境变量指定：

   - `PROCTOR_HOSTED_MODEL=provider/model`
   - 可选 `PROCTOR_HOSTED_AGENT=...`

2. `hosted-runner` 会生成：

   `opencode run -m <model> [--agent <agent>] "…"`

3. 本机冒烟验证：**`agnes/agnes-2.0-flash`** → 退出码 0 且输出 `ok`。  
   故 demo 考场 `hosted-opencode-v1` 默认改为该模型。

```bash
# 手工验收
opencode run --pure -m agnes/agnes-2.0-flash "reply with exactly ok"

# proctor
npm run proctor -- run --axis B --paperset hosted-smoke --project examples/demo-project
```

### 修法 B：修全局默认（治本，改 `~/.config/opencode/opencode.json`）

1. 查看当前默认：

   ```bash
   # agent.build.model 即为无 -m 时的落点
   opencode --version
   ```

2. 二选一：

   - 把 `agent.build.model` 改成**已有有效 apiKey 且有额度**的 `provider/model`；或
   - 给当前默认 provider 补密钥：

     ```bash
     opencode auth login
     # 或
     opencode providers login
     ```

     按交互选择 provider，写入凭证。

3. 确认 `provider.<name>.options.apiKey` / `baseURL` 正确后重试：

   ```bash
   opencode run "reply with exactly ok"
   ```

### 修法 C：额度 / 密钥本身

| 现象                        | 处理                                     |
| --------------------------- | ---------------------------------------- |
| `Unauthorized` / auth       | 修法 A 或 B；检查对应 provider 的 apiKey |
| `Token 额度不足`（LongCat） | 平台加额度或换模型（如 agnes / ark）     |
| 挂起超时（个别 ark 模型）   | 换已验证可秒回的模型，勿硬等             |

**不要**把「能归因 CONTEXT」改回伪装 PASS——拍板 D5 不变。

---

## 3. 过程记录（不降级）

| 步骤                                | 结果                                    |
| ----------------------------------- | --------------------------------------- |
| DeepSeek curl `deepseek-chat`       | 400：须用 v4 模型名                     |
| DeepSeek 工具 + `required`          | 400：Thinking 不支持该 tool_choice      |
| DeepSeek flash/pro + `auto`         | 200 + `tool_calls`                      |
| OpenCode `-m ark/deepseek-v4-flash` | 60s 超时                                |
| OpenCode `-m meituan/LongCat-2.0`   | 额度不足                                |
| OpenCode `-m agnes/agnes-2.0-flash` | **PASS（ok）**                          |
| 2×5×3 live                          | **30/30 PASS**（run `20260726-064310`） |
| hosted-smoke + 显式 model           | **PASS**（run `20260726-064410`）       |

---

## 4. 复查命令

```bash
npm run verify
PROCTOR_PROMPTFOO_LIVE=1 MATRIX_SUBJECTS=LongCat-2.0,deepseek-v4-flash \
  npm run proctor -- run --axis B --paperset model-core --project examples/demo-project
npm run proctor -- run --axis B --paperset hosted-smoke --project examples/demo-project
```
