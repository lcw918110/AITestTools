# 10 · 宿主契约文件 Schema（OpenCode）

| 字段       | 值                                                                                         |
| :--------- | :----------------------------------------------------------------------------------------- |
| 状态       | **Phase 1 终审已确认**                                                                     |
| 日期       | 2026-07-25                                                                                 |
| 依据       | PRD §4.2、§4.3、§10.1；ADR-0005 §3；素材 `wanxiangshu/kiss-docs/host-docs/00~10`           |
| 钉死版本   | **OpenCode 1.18.5**（本机）；契约 id **`opencode-v1.18`**                                  |
| 契约对照源 | **引擎对照本机 1.18.5**（ADR-0006 C4）；`kiss-docs/host-docs`（1.17.13）仅历史参考，非权威 |

---

## 1. 目标

用一份机器可读契约描述「插件用到的 hook 面 / SDK 应答语义 / 事件时序规则」。  
`fakehost` **只实现契约声明的面**；契约外调用 **fail-fast → `HARNESS`**（PRD §9）。  
同一契约生成 `contract verify` 套件，对真宿主 `opencode@1.18.5` 低频校验。契约字段与行为以 **本机 1.18.5 实测** 为准编写；host-docs 可作线索，冲突时以本机为准（ADR-0006 C4）。

---

## 2. 文件位置与命名

引擎仓（实现解冻后）：

```text
src/contract/opencode-v1.18.json          # 或 packages 内等价路径
src/contract/verify/opencode-v1.18/       # 由契约生成或手写的验证试题
```

被测考卷 L2 试题：`freeze.contract = "opencode-v1.18"`。

CLI（PRD 附录 D → 解冻后 bin 为 `proctor`）：

```text
proctor contract verify --host opencode@1.18.5
```

---

## 3. 顶层 Schema（最小充分字段）

```json
{
  "id": "opencode-v1.18",
  "host": "opencode",
  "host_version": "1.18.5",
  "host_version_range": ">=1.18.5 <1.19.0",
  "source_docs": ["kiss-docs/host-docs/00.md", "..."],
  "rev": 1,
  "hooks": [],
  "sdk": [],
  "timing_rules": [],
  "verify": {
    "suite": "contract-verify-opencode-v1.18",
    "留档路径提示": "runs/contract-verify/<date>/"
  }
}
```

### 3.1 `hooks[]` 条目

```json
{
  "name": "tool.execute.before",
  "phase": "before_tool",
  "input": {
    "required": ["sessionID", "callID", "tool", "args"],
    "properties": {
      "sessionID": { "type": "string" },
      "callID": { "type": "string" },
      "tool": { "type": "string" },
      "args": { "type": "object" }
    }
  },
  "output": {
    "allows_mutate_args": true,
    "deny": { "via": "throw_or_explicit", "notes": "以 1.18.5 实测为准" }
  },
  "coverage": "all_tools | named_only",
  "notes": "subagent 是否继承：verify 用例覆盖"
}
```

Phase 1 最小 hook 面（控制流 smoke 所需，可增不可默契）：

| hook                                         | 用途                  |
| -------------------------------------------- | --------------------- |
| `tool.execute.before` / `tool.execute.after` | 拦截与审计            |
| `event`（或文档钉死的等价事件 hook）         | idle / 生命周期       |
| `chat.message`                               | 轮次投影 / nudge 相关 |

未列入契约的 hook 被插件调用 → fakehost **立即失败**。

### 3.2 `sdk[]` 应答语义

描述假宿主必须模拟的 SDK 方法（只列插件实际用到的）：

```json
{
  "method": "session.prompt",
  "input": { "required": ["sessionID", "parts"] },
  "result": { "ok_shape": "message_id_string" },
  "errors": ["MessageAbortedError"]
}
```

### 3.3 `timing_rules[]`

```json
{
  "id": "idle-before-nudge",
  "description": "session.idle 达到 N 次后才允许某类 nudge 注入",
  "predicate": "事件序约束的人读 + 机器可检表达式",
  "verify_probe": "verify/idle-nudge.json"
}
```

禁止用裸 sleep 表达时序；verify 用事件/状态谓词（PRD 时间无关原则）。

---

## 4. `contract verify` 行为

1. 解析 `--host opencode@1.18.5`，与契约 `host_version` 比对；主版本/次版本不符 → 拒绝运行并提示重录契约。
2. 拉起本机 `opencode`（路径可配置，默认 `PATH`），跑契约 `verify.suite`。
3. 全绿 → 在 `runs/contract-verify/` 留档（run.json + 报告）；红 → 阻断「L2 结果发布」（CI 门禁语义，实现解冻时写入）。

验证红的处置：只改契约 + fakehost **一处**（PRD §4.2 O(1)）。

---

## 5. 与 L3 cassette

Phase 1 不做录制器；契约文件仍预留 `id`，供 Phase 2 对拍引用同一 `opencode-v1.18`。

---

## 6. PRD 对照检查

| PRD 要求                               | 本设计                             |
| -------------------------------------- | ---------------------------------- |
| hook 清单 + 入参形状 + SDK 应答 + 时序 | ✓ 三分节                           |
| 初稿从 host-docs 提炼                  | ✓（并强制 1.18.5 delta）           |
| fakehost 仅覆盖声明面；外调 fail-fast  | ✓                                  |
| `contract verify --host opencode@ver`  | ✓（钉 1.18.5）                     |
| PRD 示例 1.17                          | **有意升级** 为 ADR-0005 的 1.18.5 |
