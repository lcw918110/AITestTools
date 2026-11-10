# 委派链失败复盘：不是上游缺陷，是模型误读工具文档

- **状态**：已结案，**未向上游报缺陷**
- **结论时间**：2026-11-10
- **被测版本**：`wanxiangshu` @ `08b3c068a`，opencode 1.19.4
- **原计划**：报上游故障单。**执行后撤回**，理由见下

## 结论

**上游没有缺陷。** orchestrator 的编程面**确实提供完整的文件读取能力**，
工具描述与实际能力一致。失败原因是模型自己看错了工具文档，
在 125 行输出里反复声称「基类只有 commission、horizon、park、unpark、abandon」，
而实际基类有 14 个方法，包含全部文件读取方法。

## 决定性证据（实测，非推断）

调用仓内已编译产物，走**完整真实链路**：
`OfficeCapability_permissions(role)` → `JsCapabilityModule_projectRole` →
`JsCanonicalDescription_runtimeBaseClassForRole`。

### orchestrator 的真实权限与投影

```js
OfficeCapability_permissions('orchestrator');
// → 10 项：ToolPermission tag 0,1,2,3,5,8,9,14,16,23
//   tag 5=Read, 8=Glob, 9=Grep  ← 文件读取能力齐全

JsCapabilityModule_projectRole('orchestrator', perms);
// → toolName: todowrite-for-orchestrator
// → members : cat, ls, rg, stat, whereAll, where, resume, commission, horizon, review
```

### orchestrator 的真实基类方法

渲染 `runtimeBaseClassForRole('orchestrator', ...)` 后提取方法名：

```
constructor, cat, stat, ls, rg, whereAll, where, commission, resume,
horizon, review, park, unpark, abandon, run
```

**`cat` / `stat` / `ls` / `rg` / `whereAll` / `where` 全部存在。**

### contract 文案渲染正常

```js
JsCanonicalDescription_contract(prose, 'todowrite-for-orchestrator', jsCaps);
// 「优先使用 todowrite-for-orchestrator 处理所有文件系统工作。」  ← 准确
// 「它可以在一个 program 中 读取 文件——包括大规模并行批次。」      ← 动词正常，无空串
```

三个角色（orchestrator / engineer / devops）渲染结果一致，均无空动词残句。

## 模型实际做了什么

`k428` 的 `hosted-stdout.log` 共 125 行，模型反复自述：

```
根据基类定义，JsProgram没有提供任何文件系统方法。
JsProgram 基类只提供 commission、horizon、park、unpark、abandon 方法。
```

```
四次尝试后明确：JsProgram基类没有提供任何文件系统API
（this.call、this.fs、this.shell、this.glob都失败）。
```

它尝试的 `this.call`、`this.fs.readFile`、`this.shell`、`this.glob`、`this.readFile`、
`import('fs/promises')`、`require` —— **这些确实都不存在**，因为它猜错了 API 名。
真实可用的 `this.cat` / `this.stat` / `this.ls` / `this.rg` / `this.where` 它一次都没试。

工具调用统计（`⚙` 行）：

| 运行   | `todowrite-for-orchestrator` | 其他                             | 文件读取方法调用 |
| :----- | :--------------------------- | :------------------------------- | :--------------- |
| `k428` | 42                           | `askPreviousScope` 2、`join` 1   | **0**            |
| `zlx2` | 34                           | `askPreviousScope` 5、`assume` 1 | **0**            |
| `2umd` | 76                           | `askPreviousScope` 2             | **0**            |

三次都没有调用过任何真实存在的文件读取方法。

## 我为什么会判错

如实记录，避免同类错误再犯：

| 错误                                | 成因                                                                                                                                                                                              |
| :---------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 认为 orchestrator 权限集不含 `Read` | 只看了 `OfficeMatrix.fs:105` 的 `Fork; Join; Horizon; ResetScope`，**没往下追** `OfficeCapability.permissions` 的实际返回。源码里 orchestrator 的权限是另一条路径给出的，比 OfficeMatrix 那行更宽 |
| 认为 `verbs` 为空                   | 手工传了字符串 `Set(['Commission','Horizon',...])` 给 `has()`，而它比较的是 Fable Union 实例——**字符串永不匹配，任何角色都会得到空 verbs**。这个错误探针一度让我"证实"了自己的错误结论            |
| 认为 contract 无条件渲染是缺陷      | 前提（无文件能力）本身就是错的，所以结论也错                                                                                                                                                      |

第二条尤其值得记：**一个写错的探针可以"证实"任何结论**。第一次跑出「处理所有文件系统工作: true / 空动词残句: true」时，
我以为是铁证，实际是探针把能力集类型传错了。

## 那真正的问题是什么

`k428` / `zlx2` / `2umd` 三次都是 0/1，改动停在委派工作树。可复算的事实：

- `commission` 成功（`outcome = "commissioned"`，5 个 `ManagerJobCreated`）
- 工作树建成（5 个 `WorktreeCreated`）
- 只有 `#1` 改了文件（`lib/discount.mjs`、`lib/tax.mjs`）
- `materials_mutated = false`
- `k428` 在 543 秒被 `SIGKILL`、`timed_out = false`

**模型把全部预算耗在猜 API 上，没有调用真实存在的 `this.cat` 读文件。**
这属于模型行为，按本仓「不改万象术业务逻辑」的口径，应由题面或提示约束解决，
不构成上游缺陷。

## 本仓可做的改进（非上游缺陷）

1. **题面/提示层面**：若希望减少这类空转，可在任务描述里直接给出可用方法名
   （`this.cat` / `this.stat` / `this.ls`）。但这属于评测设计选择，
   也可能削弱「模型能否自己读懂工具文档」这一考察维度，需产品决策。
2. **诊断层面**：`hosted-run.json` 已有 `delegated_worktrees` /
   `delegated_changed_files` / `stranded_in_worktree` 三个字段，
   足以判定改动是否停在委派分支，无需再人工读载荷。

## 证据位置

```
examples/product-eval/runs/20261110-210204157-k428/artifacts/paired-task-157.r1.on/
  hosted-stdout.log    模型自述 125 行（含「基类只有…」的错误认知）
  hosted-stderr.log    工具调用序列
  event-store.json     ManagerJobCreated / WorktreeCreated / Terminal
  hosted-run.json      timed_out / host_signal / materials_mutated
  delegated-worktrees/ 5 个委派工作树副本
```

上游源码（只读，未改动）：

- `wanxiangli/src/capability/OfficeMatrix.fs:105`（orchestrator 的 OfficeMatrix 分支）
- `wanxiangli/src/program/Catalog.fs:46-72`、`:88-94`
- `src/Wanxiangshu/Repository/Programming/Js/Description.fs:638-662`（`contract`）
- `src/Wanxiangshu/Foundation/OfficeCapability.fs`（`permissions` 的真实来源）
