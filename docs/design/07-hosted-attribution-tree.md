# 12 · B-hosted 归因判定树 v1

| 字段     | 值                                                  |
| :------- | :-------------------------------------------------- |
| 状态     | **草案 · 待终审**                                   |
| 日期     | 2026-07-25                                          |
| 依据     | PRD §5.2、§5.3、§10.4；归因标签六选一（PRD 术语表） |
| 规则版本 | `attribution-tree-v1`                               |

---

## 1. 目标

同一试题在 **hosted** 通道跑完后，若任务失败，读取 NDJSON / 工具轨迹，写入单一主标签 `attribution`。  
禁止「无归因红灯」。hosted 聚合指标 **不可配置为 gate**（引擎硬编码拒绝）。

---

## 2. 输入

| 输入                         | 来源                                         |
| ---------------------------- | -------------------------------------------- |
| 试题 expect（oracles）       | 考卷 `items/`                                |
| 宿主退出码 / 超时 / 崩溃标记 | hosted 驱动                                  |
| 插件 NDJSON 日志             | SUT 约定路径（room 声明 `durable_log_glob`） |
| 工具调用轨迹                 | 宿主或插件导出的 trace                       |

Room 示例字段：

```json
{
  "kind": "hosted",
  "durable_log_glob": "**/.wanxiangshu.ndjson",
  "attribution_tree": "attribution-tree-v1"
}
```

---

## 3. 判定树（先匹配先胜）

```text
[0] 驱动层故障？
    超时 / 进程崩溃 / 无法采集日志 / 契约外异常
        → HARNESS

[1] 期望的协议事件或 nudge 未出现？
    （试题可声明 expect.protocol_events[] 或从 L2 同源意图推导；
      Phase 1：试题可选字段 intent.protocol_probes[]）
        → PROTOCOL

[2] 上下文组装缺关键注入？
    probes：系统提示/工具说明/必选 context 键缺失（room 声明 context_probes）
        → CONTEXT

[3] 工具轨迹相对 schema_obedience / tool_trace：
    必调工具未调或 required 字段缺失
        → MODEL_SCHEMA
    工具调用形态正确但任务断言失败（workspace_assert / 终态）
        → MODEL_TASK

[4] 工具执行业务失败且轨迹显示工具返回 structured_error
        → TOOL

[5] 未命中以上
        → HARNESS（树不完善；计入树覆盖率指标，禁止静默空归因）
```

PRD 原文树：

```text
期望 nudge/事件没出现 → PROTOCOL
上下文缺注入 → CONTEXT
插件正常，模型未调/调错 → MODEL_SCHEMA / MODEL_TASK
宿主异常 → HARNESS
```

本设计将 TOOL 与兜底 HARNESS 显式化，避免空标签；与六选一集合一致。

---

## 4. 结果字段

`results.ndjson` 每行：

```json
{
  "case_id": "B-SCHEMA-TODOWRITE-01",
  "case_rev": 1,
  "channel": "hosted",
  "pass": false,
  "attribution": "MODEL_SCHEMA",
  "attribution_tree": "attribution-tree-v1",
  "attribution_evidence": {
    "matched_rule": "[3a]",
    "refs": ["artifacts/.../trace.json", "artifacts/.../log.ndjson"]
  }
}
```

---

## 5. 指标

- `b_hosted_attribution_share`：按模型聚合失败标签占比（PRD §5.3）。
- 引擎在解析 paperset `gates` 时：若键属于 hosted 通道指标或名字含 `hosted` 且挂 gate → **validate/run 配置错误**（硬失败），满足「无法配置为 gate」。

---

## 6. PRD 对照检查

| PRD 要求           | 本设计                  |
| ------------------ | ----------------------- |
| 轨迹归因分诊       | ✓                       |
| 四类主路径 + 标签  | ✓（扩展 TOOL/兜底）     |
| 写入 attribution   | ✓                       |
| hosted 不可挂 gate | ✓ 硬编码                |
| 判定树版本化       | ✓ `attribution-tree-v1` |
