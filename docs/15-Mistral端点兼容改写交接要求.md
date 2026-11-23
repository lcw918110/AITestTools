# Mistral 端点兼容改写 · 交接要求

| 字段     | 值                                           |
| :------- | :------------------------------------------- |
| 状态     | **待实现**（交由代理项目实现）               |
| 日期     | 2026-11-23                                   |
| 提出方   | AITestTools（评测器侧）                      |
| 承接方   | 代理项目                                     |
| 前置排查 | 2026-11-23 综合排查（本文第 1 节为实测证据） |

> 本文只描述**承接方需要实现什么**，不复述排查过程。证据均在本机实测取得。

## 1. 问题定义

### 1.1 事实：`mistral-large-latest` 的 `content` 是数组

该模型**强制**在响应正文前置 thinking 块，`content` 字段不再是 OpenAI 标准的字符串：

**非流式**（`stream: false`）：

```json
"content": [
  { "type": "thinking", "thinking": [{ "type": "text", "text": "用户用中文说了…" }], "closed": true },
  { "type": "text", "text": "Hi！👋 很高兴见到你！" }
]
```

**流式**（`stream: true`）逐帧结构：

| 帧序      | `choices[0].delta.content` 形态                                               | 说明                     |
| :-------- | :---------------------------------------------------------------------------- | :----------------------- |
| 第 1 帧   | `""`（字符串）                                                                | 仅有 `role: "assistant"` |
| 第 2…N 帧 | `[{"type":"thinking","thinking":[{"type":"text","text":"…"}],"closed":true}]` | thinking 增量，逐帧一片  |
| 后续帧    | `[{"type":"text","text":"…"}]`                                                | 正文增量（数组形态）     |
| 再后续帧  | `"…"`（字符串）                                                               | 正文增量，**回到字符串** |
| 末帧      | `data: [DONE]`                                                                | 结束                     |

实测一次 118 帧的样本分布：`str:empty` 1 帧、`array:thinking` 112 帧、`array:text` 1 帧、`str:text` 5 帧。

### 1.2 佐证：该端点会**混用**两种形态

同一次响应里既有数组 content 又有字符串 content，说明这不是"整个响应格式变了"，而是 thinking 段落用数组、正文段落用字符串。承接方的改写必须同时处理这两种形态，不能按"整个响应是数组"一刀切。

### 1.3 对照：`mistral-medium-latest` 与 `mistral-small-latest` 返回标准字符串

同一端点、同一 key：

```json
"delta": { "content": "Hello" }
```

**因此这不是端点整体不合规，而是 large 模型独立的响应行为。**

### 1.4 影响：评测器无法消费

AITestTools 通过 opencode 调用模型，opencode 使用 `@ai-sdk/openai-compatible`，该校验器要求 `delta.content` 为字符串，收到数组直接报错：

```text
Type validation failed: Value: [{"type":"thinking",…}]
Error message: Invalid input
  path: ["choices", 0, "delta", "content"]
  message: "Invalid input: expected string, received array"
```

## 2. 需要承接方实现的改写契约

### 2.1 目标

在**代理层**（客户端与 `api.mistral.ai` 之间）把响应改写为严格符合 OpenAI Chat Completions 规范的形态，使标准客户端可直接消费。

### 2.2 改写规则

**非流式**：

- 若 `choices[i].message.content` 是数组：取其中 `type === "text"` 的条目，按顺序拼接 `text` 字段，作为字符串写回。
- 若数组中**没有** `type === "text"` 的条目：写回 `""`（空字符串），不得写回 `null`。
- `thinking` 条目**丢弃**（不要求透传；如需保留可另放在非标准字段，但不得占据 `content`）。

**流式**：

- 逐帧检查 `choices[i].delta.content`。
- 数组形态 → 按上述规则拍平为字符串后写回同一位置。
- 已被拍平的结果若为空串，仍需保留该帧（客户端依赖帧序推进），但 `content` 必须是 `""` 而非 `null` 或缺失。
- `data: [DONE]` 原样透传。
- **不得缓冲整个响应后再一次性发出**：客户端按增量渲染，整包重放会破坏流式语义并改变超时行为。

**其余字段**：

- `id`、`object`、`created`、`model`、`choices[i].index`、`finish_reason`、`usage` 原样保留。
- `choices[i].delta.tool_calls` 原样保留（实测 `tool_calls` 本身是标准格式，无需改写）。
- 顶层非标准字段（实测存在 `"p": "abcdefghijklmnopqrstuv"`）可原样保留或丢弃，不影响客户端。

### 2.3 必须支持的范围

| 项       | 要求                                                                                                           |
| :------- | :------------------------------------------------------------------------------------------------------------- |
| 接口     | `POST /v1/chat/completions`                                                                                    |
| 流式     | 必须支持（`stream: true`），且保持增量下发                                                                     |
| 非流式   | 必须支持                                                                                                       |
| 工具调用 | 必须正确透传 `tool_calls`，不得因改写破坏 `finish_reason: "tool_calls"`                                        |
| 其他模型 | `mistral-medium-latest`、`mistral-small-latest` 等返回字符串的模型，改写后须与原响应**逐字节等价**（不得误伤） |
| 其他接口 | `/v1/models`、`/v1/embeddings` 等非 chat 接口原样透传                                                          |

### 2.4 兼容性红线

1. **不得改变语义**：改写只做"数组 → 字符串"的形态转换，不得增删正文内容、不得改动顺序。
2. **不得吞 thinking 正文**：若 thinking 与 text 混杂在同一帧内（实测存在），只提取 `type === "text"`，不得把 thinking 文本混入正文。
3. **不改请求**：只改写响应。请求体（含 `max_tokens`、`tools`、`reasoning_effort`）原样转发。
4. **认证透传**：`Authorization` 头原样转发，不做替换。
5. **错误响应不改写**：上游 4xx/5xx 的 `{"object":"error",...}` 原样透传，便于客户端排查。

## 3. 验收标准

承接方交付前须自证以下各条：

| 编号 | 用例                                                         | 通过判据                                                |
| :--- | :----------------------------------------------------------- | :------------------------------------------------------ |
| V1   | `mistral-large-latest` 非流式普通对话                        | `content` 为字符串，含正文，不含 thinking 文本          |
| V2   | `mistral-large-latest` 流式普通对话                          | 每帧 `content` 均为字符串或空串；客户端可完整拼接出正文 |
| V3   | `mistral-large-latest` 带 `tools` 调用                       | `tool_calls` 完整，`finish_reason === "tool_calls"`     |
| V4   | `mistral-large-latest` 仅 thinking 无正文（小 `max_tokens`） | `content` 为 `""`，不报错、不返回 `null`                |
| V5   | `mistral-medium-latest` 流式 + 非流式                        | 改写前后**逐字节等价**                                  |
| V6   | `/v1/models`                                                 | 原样透传，`HTTP 200`                                    |
| V7   | 上游返回 400（如 `reasoning_effort: "none"`）                | 错误体原样透传，状态码不变                              |

**建议的自测命令**（承接方本机执行）：

```bash
# V2：观察逐帧 content 形态
curl -sN "$PROXY/v1/chat/completions" \
  -H "Authorization: Bearer $KEY" -H 'Content-Type: application/json' \
  -d '{"model":"mistral-large-latest","messages":[{"role":"user","content":"说 hi"}],"max_tokens":500,"stream":true}' \
  | grep '^data: {' \
  | python3 -c "
import json,sys
from collections import Counter
c=Counter()
for line in sys.stdin:
    d=json.loads(line[6:])
    v=d['choices'][0]['delta'].get('content')
    c['array' if isinstance(v,list) else 'str']+=1
print(dict(c))
"
```

**期望输出**：`{'str': N}`，**不得出现 `array`**。

## 4. 部署与接入

### 4.1 网络路径

评测环境已具备"沙箱经本机全局代理出网"的能力（AITestTools 侧已实现 `PROCTOR_HOSTED_PROXY=1`，通过 sandbox-runtime 的 `parentProxy` 生效）。承接方的改写服务应部署在：

```text
opencode（沙箱内） → sandbox-runtime parentProxy → 本机代理 → 改写服务 → api.mistral.ai
```

或

```text
opencode（沙箱内） → sandbox-runtime parentProxy → 改写服务 → api.mistral.ai
```

第二条更简单，前提是改写服务自身能出网（可自行走上游代理）。**由承接方确定并明确告知评测侧最终需要配置的地址。**

### 4.2 评测侧的接入点

评测侧只需拿到一个 OpenAI 兼容的 `baseURL`，配置在 `~/.config/opencode/opencode.json` 的 provider 中：

```json
{
  "provider": {
    "mistral": {
      "npm": "@ai-sdk/openai-compatible",
      "options": { "baseURL": "<承接方提供的地址>", "apiKey": "<key>" }
    }
  }
}
```

以及考场声明的 `host_model`：

```json
{ "recipe": { "host_model": "mistral/mistral-large-latest" } }
```

**承接方交付时必须明确给出**：`baseURL`、监听端口、是否需要认证头透传、是否需要评测侧额外配置。

## 5. 已知约束与不做的事

1. **不改请求侧**：`reasoning_effort` 只接受 `high`/`low`/`medium`（`none` 返回 400）；`thinking` 字段不被接受（422）。这些都属上游行为，不在改写范围。
2. **不要求"关闭 thinking"**：实测各档位均无法关闭，需求是**容忍并拍平**，不是消灭。
3. **不改评测器代码**：AITestTools 侧已完成的 `parentProxy` 接入即为全部改动；承接方的改写服务独立部署，不改评测器。
4. **不改万象术业务逻辑**。
5. **不追求通用网关**：只针对本文第 2 节列出的接口与模型，不做通用 LLM 网关。

## 6. 评测侧现有状态（供承接方了解边界）

| 项                           | 状态                                        |
| :--------------------------- | :------------------------------------------ |
| `mistral-medium-latest` 通路 | 已验证可用（沙箱内 190 次调用、0 隧道错误） |
| `mistral-large-latest` 通路  | **阻塞于本文第 1 节**，待承接方改写后解除   |
| 沙箱出网                     | 已打通（`parentProxy`），无需承接方处理     |
| 认证                         | 已修复，`mstrl_` 前缀 key 有效              |

> 补充事实（供承接方评估影响）：`mistral-medium-latest` 虽可正常调用，但在本评测的插件场景中表现不足——插件为 orchestrator 提供 6 个定制工具（`askPreviousScope`、`assume`、`horizon`、`join`、`skill`、`todowrite-for-orchestrator`），medium 无法正确遵循该契约，出现反复调用不存在的工具 `'invalid'`、190 轮空转至超时。同一题在无插件场景 32 秒正常完成。这是选用 `mistral-large-latest` 的**主要动机**，而非单纯追求更强模型。
