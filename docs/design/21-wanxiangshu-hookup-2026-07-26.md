# 万象术接入记录（2026-07-26）

| 字段     | 值                                                                         |
| :------- | :------------------------------------------------------------------------- |
| 权威题库 | **`wanxiangshu/papers`**（已迁出引擎 examples）                            |
| L1       | 真 Fold **5/5**                                                            |
| L2       | **`hook_style: opencode-v1`** 假宿主控流 **2/2**（shim，非完整 Plugin.js） |
| hosted   | **Plugin + NDJSON 归因 PASS**（`assistant_completed`；见 design/23）       |

---

## 「故意未宣称完成」是什么意思？

先前说「L2/hosted 真 Plugin 未宣称完成」，**不是**说工作停了，而是避免把两件不同的事混成一件：

| 说法                               | 实际含义                                                                                 | 能否宣称？                                    |
| ---------------------------------- | ---------------------------------------------------------------------------------------- | --------------------------------------------- |
| L1 接入万象术                      | 直接 `import` 仓库里编译出的 `Fold.js`，喂 NDJSON，断言投影                              | ✅ 已通                                       |
| L2 OpenCode hook 面                | 假宿主按官方名派发 `event` / `tool.execute.after` / `chat.message`，插件用同名 hook 响应 | ✅ 本轮已通（shim）                           |
| 「完整万象术 Plugin 在假宿主跑通」 | 加载 `build/.../Plugin.js` 全量（MCP、工具面、真 ctx）                                   | ❌ **仍未做**——假宿主给不了真 OpenCode 运行时 |
| hosted + `.wanxiangshu.ndjson`     | 真 `opencode run` + 读 durable log 归因                                                  | ❌ 仍未做                                     |

所以：**协议/时序层的 L2 可以说完成；「整颗真 Plugin 嵌进假宿主」不能说完成。**

---

## 本轮落地

1. 引擎 `room.adapter.hook_style`：`demo-v1` \| `opencode-v1`（schema + `l2-runner`）。
2. 题库迁至 `wanxiangshu/papers/`（L1+L2）；引擎 `examples/wanxiangshu-papers` 仅留指针。
3. L2 shim：`papers/adapters/l2-control-flow-plugin.mjs`（事件 Kind 用万象术 snake_case）。

### 命令

```bash
# 在 AITestTools
npm run proctor -- run --axis A --paperset smoke-A-L1 --project ../wanxiangshu/papers
npm run proctor -- run --axis A --paperset smoke-A-L2 --project ../wanxiangshu/papers
```
