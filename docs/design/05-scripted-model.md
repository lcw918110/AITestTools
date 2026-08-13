# 13 · Scripted 模型（剧本）语法

| 字段 | 值                                                |
| :--- | :------------------------------------------------ |
| 状态 | **草案 · 待终审**                                 |
| 日期 | 2026-07-25                                        |
| 依据 | PRD §4.2、§4.4、§10.5；L2 `model_driver=scripted` |

---

## 1. 目标

在契约假宿主（fakehost）上提供 **确定性、有限分支** 的模型应答，覆盖 nudge 时机、审查闭环等控制流，不引入真模型噪声。

---

## 2. 引用方式

试题 L2：

```json
"freeze": {
  "layer": "L2",
  "contract": "opencode-v1.18",
  "model_driver": "scripted",
  "script": "scripts/review-pass-v1.json"
}
```

`script` 相对考卷库根（`papers/`）。Validate：L2 必填 `contract` + `script`（PRD §4.4）。

---

## 3. 文件顶层形状

```json
{
  "id": "review-pass-v1",
  "rev": 1,
  "version": "scripted-model-v1",
  "entry": "start",
  "nodes": {
    "start": { "...": "..." }
  }
}
```

| 字段      | 说明                         |
| --------- | ---------------------------- |
| `version` | 协议名；未知则 validate 失败 |
| `entry`   | 起始节点 id                  |
| `nodes`   | 节点表；禁止运行时动态增删   |

---

## 4. 节点类型

### 4.1 `assistant_text`

```json
{
  "type": "assistant_text",
  "text": "我将提交审查。",
  "next": "call-submit"
}
```

### 4.2 `tool_calls`

```json
{
  "type": "tool_calls",
  "calls": [
    {
      "name": "submit_review",
      "args": { "report": "...", "affectedFiles": ["a.ts"] }
    }
  ],
  "next": "after-submit"
}
```

- 一轮可多 call（顺序固定）。
- 假宿主按契约触发 `tool.execute.before/after`；工具结果由 fakehost / fixture 提供，**剧本不写真实执行**。

### 4.3 `terminal`

```json
{
  "type": "terminal",
  "reason": "stop" | "end_turn" | "abort"
}
```

无 `next`。到达即结束本轮模型驱动。

### 4.4 `branch`（有限分支）

```json
{
  "type": "branch",
  "on": [
    {
      "when": {
        "hook": "event",
        "name": "session.idle",
        "count_gte": 2
      },
      "next": "nudge-again"
    },
    {
      "when": { "tool_result": { "name": "submit_review", "ok": true } },
      "next": "done"
    }
  ],
  "else": "fail-path"
}
```

| 约束           | 说明                                                                                                                         |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| 分支条件白名单 | 仅 `hook`（名 + 可选计数）、`tool_result`（name + ok）、`state_predicate`（对 fakehost 暴露的只读投影，表达式子集同文档 14） |
| 禁止           | 读时钟、随机、任意 JS                                                                                                        |
| `else`         | 必填，保证完备                                                                                                               |
| 深度           | 单剧本 `branch` 嵌套（沿 next 路径）≤ 8；节点总数 ≤ 64（validate）                                                           |

---

## 5. 驱动语义

1. fakehost 需要「模型下一步」时，从当前节点执行。
2. `assistant_text` / `tool_calls` 产出对应宿主消息/工具调用后跳转 `next`。
3. `branch` 按 `on` 数组 **先匹配先胜**；均不匹配走 `else`。
4. `terminal` 后不再产生模型输出；若宿主仍索要模型轮次 → 归因 **`HARNESS`**（剧本过短）或试题预期的 PROTOCOL（若测的是「不得再问模型」）。
5. 剧本缺节点 / `next` 悬空 → validate 失败。

时间无关：等待只用 hook 计数或状态谓词；禁止 `sleep_ms`（除非标内部且不进试题资产）。

---

## 6. 样例骨架（nudge 两次 idle）

见考卷库 `scripts/no-progress-twice.json` 一类资产：在第二次 `session.idle` 分支到 nudge 文本节点，再 `terminal`。

---

## 7. PRD 对照检查

| PRD 要求                                    | 本设计                      |
| ------------------------------------------- | --------------------------- |
| 按步 assistant_text / tool_calls / terminal | ✓                           |
| 支持有限分支                                | ✓（`branch` + 白名单 when） |
| L2 必填 script                              | ✓                           |
| 确定性、可重放                              | ✓（无随机/裸睡）            |
