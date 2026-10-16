# 14 · `state_predicate` 表达式子集

| 字段 | 值                                                                             |
| :--- | :----------------------------------------------------------------------------- |
| 状态 | **Phase 1 终审已确认**                                                         |
| 日期 | 2026-07-25                                                                     |
| 依据 | PRD 附录 B（`state_predicate`）、§10.6；实现约束：白名单字段、禁止任意代码执行 |

---

## 1. 目标

在折叠态（或显式 `root`）上求值布尔表达式，**无函数调用、无赋值、无循环**；失败返回 `oracle_id` / `message` / `evidence_ref`。

---

## 2. Oracle 形状

```json
{
  "type": "state_predicate",
  "id": "review-closed",
  "expr": "review.required == false && review.verdict == 'Passed'",
  "root": "$fold"
}
```

| 字段   | 必填 | 说明                                                               |
| ------ | ---- | ------------------------------------------------------------------ |
| `expr` | 是   | 表达式字符串                                                       |
| `id`   | 建议 | 稳定 id；缺省则引擎生成 `state_predicate#<index>`                  |
| `root` | 否   | 求值根：`$fold`（默认，Fold 返回值）\| `$events`（事件数组，只读） |

---

## 3. 语法（EBNF 子集）

```text
expr     = or_expr
or_expr  = and_expr ( '||' and_expr )*
and_expr = cmp_expr ( '&&' cmp_expr )*
cmp_expr = unary ( ( '==' | '!=' | '<' | '<=' | '>' | '>=' ) unary )?
unary    = '!' unary | primary
primary  = path | literal | '(' expr ')'

path     = ident ( '.' ident | '[' int ']' | '[' string ']' )*
ident    = [A-Za-z_][A-Za-z0-9_]*
literal  = 'true' | 'false' | 'null' | number | string
string   = "'" [^']* "'" | '"' [^"]* '"'
number   = 整数或小数（无科学计数 Phase 1）
```

**禁止**：函数调用、`new`、赋值、正则字面量、模板字符串、`undefined` 关键字、属性名动态计算、`__proto__` 访问。

---

## 4. 求值语义

1. 词法/句法非法 → validate 失败（资产错误），不进入 run。
2. 路径穿越中某一段为 `null`/`undefined` → 该 primary 值为 `null`（不抛）。
3. `==` / `!=`：JSON 宽松相等（`1 == "1"` 为 false；`null == null` 为 true；不与 JS `==` 完全同一，采用 **同型深度相等** 或标量严格相等）。  
   **Phase 1 钉死**：标量用 `Object.is` 规范化后的严格相等（`+0`/`-0` 区分、`NaN` 不等于自身——谓词侧禁止 NaN）；对象/数组仅允许 `==`/`!=` 整树深度相等。
4. 大小比较仅允许 **number** 或 **string**（Unicode 码位序）；混型 → oracle 失败，`message` 说明类型错误，归因 **`HARNESS`**（试题写坏）或校验期拦截。
5. 最终结果必须是 boolean；非 boolean → 失败。

---

## 5. 与样例 PRD 表达式

PRD / Phase 0 样例：

```text
review.required == false && review.verdict == 'Passed'
```

要求 Fold 返回值（normalize 后）含：

```json
{ "review": { "required": false, "verdict": "Passed" } }
```

若真实 Fold 返回扁平或 Fable 形状不同，由试题改用匹配路径，或在 room 增加可选 `project` 导出（Phase 1 不做自动投影，避免藏逻辑）。

---

## 6. 失败证据

```json
{
  "oracle_id": "review-closed",
  "message": "predicate false: review.required == false && review.verdict == 'Passed'",
  "evidence_ref": "artifacts/<case>/fold-state.json"
}
```

`evidence_ref` 指向当次 run 写入的折叠态快照。

---

## 7. PRD 对照检查

| PRD 要求                                  | 本设计                                       |
| ----------------------------------------- | -------------------------------------------- |
| 布尔表达式、白名单字段                    | ✓（路径白名单 = 数据上存在的键；无任意代码） |
| 禁止 Oracle 内发 prompt                   | ✓                                            |
| 失败含 oracle_id / message / evidence_ref | ✓                                            |
| JSONPath + 比较、无函数                   | ✓（点路径 ≈ 受限 JSONPath）                  |
