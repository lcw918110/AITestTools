# 11 · L1 Fold 入口接入约定

| 字段         | 值                                                                                                                    |
| :----------- | :-------------------------------------------------------------------------------------------------------------------- |
| 状态         | **草案 · 待终审**                                                                                                     |
| 日期         | 2026-07-25                                                                                                            |
| 依据         | PRD §4.1、§4.4、§10.2；ADR-0005 §4                                                                                    |
| PRD 偏差说明 | PRD 示例把 `freeze.fold_entry` 写成模块路径；本设计改为 **逻辑名**，路径放在 room 的 `fold_entries`（多入口、多被测） |

---

## 1. 目标

使 `agent-proctor` 在 **零宿主、零网络** 下动态 `import` 被测项目的 JS Fold/投影产物，喂事件序列，得到可 JSON 化的折叠态，供 `event_fold` / `state_predicate` / `no_event` 判定。

引擎 **不** 解析 F# 源码；只依赖约定导出与事件 schema 版本。

---

## 2. Room 配置：`fold_entries`（多项）

考场（原 profile，目录 `rooms/`）在 `kind: fold`（或兼有 fold 能力的 room）中声明：

```json
{
  "name": "fold-wanxiangshu-v1",
  "kind": "fold",
  "model_driver": "none",
  "network": false,
  "fold_entries": {
    "review-task": {
      "module": "build/src/Kernel/EventLog/Fold.js",
      "export": "foldReviewTask",
      "signature": "session_fold_v1",
      "event_schema": "wanxiangshu-ndjson-v1",
      "resolve_root": "sut"
    },
    "nudge-dedup": {
      "module": "build/src/Kernel/EventLog/Fold.js",
      "export": "foldNudgeDedup",
      "signature": "session_fold_v1",
      "event_schema": "wanxiangshu-ndjson-v1",
      "resolve_root": "sut"
    }
  },
  "sut": {
    "name": "wanxiangshu",
    "root_env": "SUT_ROOT",
    "root_rel": null
  }
}
```

| 字段           | 含义                                                              |
| -------------- | ----------------------------------------------------------------- |
| 键（逻辑名）   | 试题 `freeze.fold_entry` 引用的名字                               |
| `module`       | 相对 **SUT 根**（或资产根，见 `resolve_root`）的 ESM/CJS 模块路径 |
| `export`       | 具名导出；禁止默认导出猜名                                        |
| `signature`    | 调用约定版本（见 §3）                                             |
| `event_schema` | 事件信封版本 id；须与试题/stimulus 一致                           |
| `resolve_root` | `sut` \| `project`：模块相对被测仓根或考卷库根                    |
| `normalize`    | 缺省 **`json_clone`**（ADR-0006 C2）；可改 `none`                 |
| `sut.root_env` | 运行时从环境变量取被测仓绝对路径（推荐）；未设则报 `HARNESS`      |

`wanxiangshu` 仅为首个样例 room；其它产品另建 room，互不耦合。

---

## 3. 签名约定（`signature`）

### 3.1 `session_fold_v1`（Phase 1 首选）

```ts
type Event = {
  Kind: string;
  Session: string;
  Payload: Record<string, unknown>; // 或 Map 序列化后的普通对象
  // 允许额外字段；引擎不做完整校验，只保证可 JSON 克隆
};

type SessionFoldV1 = (sessionId: string, events: Event[]) => unknown;
```

- 引擎：读 stimulus NDJSON → 解析为 `Event[]` → 调用 `export(sessionId, events)`。
- `sessionId`：来自试题 `freeze.session_id`，缺省取事件中出现次数最多的 `Session`，仍歧义则失败（`HARNESS`）。
- 返回值：任意结构；**默认**经 `normalize: "json_clone"`（`JSON.parse(JSON.stringify(v))`）后再与期望比较（ADR-0006 C2）。entry 可显式 `"normalize": "none"`。克隆失败 → `HARNESS`。

对照：`wanxiangshu` 的 `foldReviewTask` / `foldNudgeDedup` 符合此形。

### 3.2 `pure_fold_v1`

```ts
type PureFoldV1 = (events: Event[], initial?: unknown) => unknown;
```

无 session 维的折叠。

### 3.3 未声明 / 未知 `signature`

Validate / run 一律失败，归因 **`HARNESS`**（接入错误，非产品 PROTOCOL）。

Phase 1 **只实现** `session_fold_v1` 与 `pure_fold_v1`；其它签名需升协议版本。

---

## 4. 试题侧 `freeze`（L1）

```json
"freeze": {
  "layer": "L1",
  "fold_entry": "review-task",
  "model_driver": "none",
  "event_schema": "wanxiangshu-ndjson-v1",
  "session_id": "sess-demo-1"
}
```

Validate（对齐 PRD §4.4，并叠加 ADR-0005）：

| 规则           | 行为                                             |
| -------------- | ------------------------------------------------ |
| `layer=L1`     | 必填 `fold_entry`（逻辑名）、`model_driver=none` |
| 禁填           | `contract` / `script` / `cassette`               |
| `fold_entry`   | 必须在绑定 room 的 `fold_entries` 中存在         |
| `event_schema` | 试题与 entry 声明必须一致，否则 validate 失败    |

PRD 原文路径写法视为 **历史示例**；资产迁到 `papers/` 后一律逻辑名。

---

## 5. Stimulus

- `stimulus.kind = event_sequence`
- `ref` 指向 `materials/.../*.ndjson`（一行一个事件 JSON）
- 禁止裸 `sleep_ms`（PRD 附录 D）；夹具内部 debounce 须标 `harness_internal`（实现解冻后字段名可改为 `proctor_internal`，需兼容别名）

事件 schema `wanxiangshu-ndjson-v1` 最小字段：`Kind`、`Session`、`Payload`（object）。缺字段 → oracle 前失败，`HARNESS`。

---

## 6. 与 Oracle 的衔接

| Oracle            | 输入                                                                    |
| ----------------- | ----------------------------------------------------------------------- |
| `event_fold`      | Fold 返回值 vs `materials/.../expected-fold.json`（深度相等，键序无关） |
| `state_predicate` | 对 Fold 返回值（及可选投影）求值，见 `04-state-predicate.md`            |
| `no_event`        | 对 **stimulus 事件流**（非折叠态）检查禁止 `Kind`                       |

失败归因默认：折叠结果不符合不变量且意图为协议 → **`PROTOCOL`**（由试题 `intent.attribution_focus` 与 oracle 失败映射表决定；人为改坏 Fold → 期望 PROTOCOL）。

---

## 7. 非法输入与失败归因

| 情况                         | 归因                                                                               |
| ---------------------------- | ---------------------------------------------------------------------------------- |
| 模块路径不存在 / import 失败 | HARNESS                                                                            |
| export 缺失或非函数          | HARNESS                                                                            |
| 事件 JSON 解析失败           | HARNESS                                                                            |
| Fold 抛异常                  | 默认 PROTOCOL（被测折叠逻辑）；若 stack 含引擎帧则可标 HARNESS（实现时用边界包装） |
| 返回值不可序列化             | HARNESS                                                                            |
| 期望折叠态不匹配             | 按 intent / oracle 映射，多为 PROTOCOL                                             |

---

## 8. 样例（考卷隐喻）

```text
papers/rooms/fold-wanxiangshu-v1.json          # 含 fold_entries
papers/items/A/todo-fold.case.json             # freeze.fold_entry = "review-task"
papers/materials/DEMO-A-TODO-FOLD-01/stimulus.ndjson
papers/materials/DEMO-A-TODO-FOLD-01/expected-fold.json
```

---

## 9. 开放问题（本篇）

1. Fable 特殊对象若 `json_clone` 丢信息，是否为该 entry 改 `none` 并自备 plain 导出？**默认仍 json_clone**；个案再开。
2. 多 session 刺激是否允许？Phase 1 建议 **单 session**，多 session 标 draft。

---

## 10. PRD 对照检查

| PRD 要求                       | 本设计                             |
| ------------------------------ | ---------------------------------- |
| import Fold 产物，不感知 F#    | ✓                                  |
| profile 声明入口 + 事件 schema | ✓（room.`fold_entries`）           |
| 零宿主零网络毫秒级             | ✓（`network: false`，无 host）     |
| L1 禁 contract/script          | ✓                                  |
| 多被测可配置                   | ✓（ADR-0005，超越 PRD 单路径示例） |
