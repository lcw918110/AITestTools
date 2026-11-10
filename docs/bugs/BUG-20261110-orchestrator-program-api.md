# BUG-20261110：委派成功但 `join` 之后停摆，改动未回到播种目录

- **严重级别**：P1（多智能体编排链无法交付；单智能体路径不受影响）
- **状态**：待上游确认。本单只陈述已复算的事实与明确标注的未决点
- **发现时间**：2026-11-09 起，2026-11-10 三次带载荷复现后定性
- **被测版本**：`wanxiangshu` @ `08b3c068a`，opencode 1.19.4，插件 `dist/OpenCode/Plugin/Plugin.js`
- **影响面**：走 `orchestrator → manager → engineer` 委派的编程类任务
- **报障方**：AITestTools（监考侧）。按「不改万象术业务逻辑」，本仓只提供证据，不做修复

## 一句话结论

`commission` **是成功的**（`outcome = "commissioned"`，事件流有 5 个 `ManagerJobCreated`），
工作树也建成了（5 个 `WorktreeCreated`）。问题发生在**之后**：
orchestrator 在第 621 行发出 `join` 取结果，**此后到进程被杀为止再无任何工具调用**
（只有 34 条 `stream`），运行在 543 秒被 `SIGKILL`。
最终没有任何改动回到播种目录，`materials_mutated=false`。

即：**委派建立成功，结果回收后没有推进**。不是工具缺失，也不是 600 秒不够。

## 时间线（`k428`，单次运行内部按 `hosted-stderr.log` 行号）

| 行号 | 时刻          | 事件                                                                     |
| :--- | :------------ | :----------------------------------------------------------------------- |
| 1    | 13:02:06      | 实例创建，运行开始                                                       |
| 12   | —             | 根会话 `ses_e3a72cac7ffe…`（orchestrator）                               |
| 84   | —             | manager 会话 `ses_e3a710712ffe…`（`parentID=ses_e3a72cac…`）             |
| —    | 13:02–13:10   | orchestrator 反复在 `todowrite-for-orchestrator` 里试 API（见下节）      |
| 557  | 13:10:16      | engineer 会话 `ses_e3a6b55a…`                                            |
| 559  | 13:10:17      | engineer 会话 `ses_e3a6b517…`                                            |
| 594  | 13:10:23      | `todowrite-for-orchestrator`，内部 `this.commission` 返回 `commissioned` |
| 621  | 13:10:29      | **`join`**（`scope.kind = keepLast`）—— **全流程最后一次工具调用**       |
| —    | 13:10:29 之后 | **零工具调用**，34 条 `stream`                                           |
| 766  | 13:11:02      | manager 仍在 `stream`                                                    |
| 779  | 13:11:08      | engineer 仍在 `stream`（`agent=engineer`）                               |
| 791  | 13:11:09      | `WorkStillActive`；随后进程被 `SIGKILL`                                  |

`hosted-run.json`：

| 字段                | 值        |
| :------------------ | :-------- |
| `duration_ms`       | `543490`  |
| `deadline_ms`       | `600000`  |
| `timed_out`         | `false`   |
| `host_signal`       | `SIGKILL` |
| `materials_mutated` | `false`   |
| `workspace_ok`      | `false`   |

**关键**：`timed_out=false`、543 秒就被杀，说明不是打满 600 秒超时，而是外部在
subagent 无进展的状态下终止了运行。

## orchestrator 侧的 API 试探（现象，非终局根因）

`k428` 的 `hosted-stderr.log` 里 `todowrite-for-orchestrator` 作为工具调用出现 **44 行**
（若按字符串出现数则是 75 次，差额来自同一 program 内重复引用方法名与
`scope.replacement` 自述文本）。`todowrite-for-manager` 出现 **0 次**。

模型反复尝试并失败的 API（均为 `hosted-stderr.log` 实测）：

| 尝试                                                          | 实测次数 | 结果                                     |
| :------------------------------------------------------------ | :------- | :--------------------------------------- |
| `import('child_process')`                                     | 4        | `ERR_VM_DYNAMIC_IMPORT_CALLBACK_MISSING` |
| `import('fs/promises')`                                       | 3        | 同上                                     |
| `require(...)`                                                | —        | 运行时不提供 `require`                   |
| `this.call` / `this.fs.readFile` / `this.shell` / `this.glob` | —        | 方法不存在                               |

模型自己的纠正记录（`scope.replacement` 原文）：

```
连续四次错误地尝试使用todowrite-for-orchestrator中不存在的文件API
（call、fs.readFile、shell、glob）。该工具的JsProgram基类只提供orchestration方法
（commission、horizon、park、unpark、abandon），不提供文件系统访问。
```

这与源码推导一致：`wanxiangli/src/capability/OfficeMatrix.fs:105` 给 orchestrator 的权限集是
`Fork; Join; Horizon; ResetScope`，没有 `Read`/`Write`/`Exec`；
`Catalog.fs:46-72` 的 `fragments` 因此不会投影出 `this.cat` / `this.write` / `this.call`。

**但这一段不是终局根因**：13:10:23 模型已经用对了 `commission` 并成功委派，
之后只再发了一次 `join`，然后彻底停止。所以「API 试探」消耗了前期时间，
但不是最后没有交付的原因。

## `join` 之后为什么停摆（未决点）

`hosted-stdout.log:122-125` 是模型自己的说明：

```
commission 已成功委派给 DevOps（outcome = "commissioned"），但返回中没有实际的
文件内容和测试结果。根据共同法，commission 只是发起委派，实际结果需要通过
join 或 horizon 来获取。但我已用尽当前 Scope 的 retention。

retention 已用尽，必须 resetScope。已成功使用 commission 委派 DevOps 读取文件和
运行测试。现在需要用 join 获取 DevOps 的返回结果：
```

上游对应实现 `wanxiangtong/opencode/provider-request/RequestProjection.fs:691-711`：
`retention.remaining = 0` 时强制要求 `scope.kind = resetScope`（注释称 resource 路径
名为历史遗留）。模型照做了 `resetScope` 并发了 `join`，**此后没有任何后续动作**。

这一点需要上游确认，本仓无法判定是：

- (a) `join` 的返回没有把委派结果带回给模型（结果丢失）；
- (b) `resetScope` 之后的上下文把之前的委派上下文清掉了，模型不知道还能做什么；
- (c) 模型自身在该点放弃。

三种解释对应完全不同的修复方向，本仓证据不足以区分。

## 已确认的实体与关系

### 委派事实齐全

| 事件                      | 次数 |
| :------------------------ | :--- |
| `ManagerJobCreated`       | 5    |
| `WorktreeCreateRequested` | 5    |
| `WorktreeCreated`         | 5    |
| `ChildWorkVoided`         | 2    |
| `HandleWorkConsumed`      | 2    |

`ManagerJobCreated` 载荷示例：

```json
{
  "Byname": "tests-invoice-test-mjs-l",
  "ManagerAgent": "manager",
  "ManagerJobId": ["ManagerJobId", "qxcr5a"],
  "TargetBranchFrozen": "master",
  "ManagerSessionId": ["SessionId", "ses_e3a710712ffeNGxh8OC30OLxpF"],
  "WorktreePath": ["WorktreePath", "/tmp/claude/wanxiangshu-qxcr5a"]
}
```

### 会话归属：两套口径并存，需上游澄清

从 `hosted-stderr.log` 的 `message=created` 逐行解析（共 28 次）：

| 会话                | `parentID`          | `agent`  | 行号 |
| :------------------ | :------------------ | :------- | :--- |
| `ses_e3a72cac7ffe…` | —（根）             | —        | 12   |
| `ses_e3a710712ffe…` | `ses_e3a72cac7ffe…` | manager  | 84   |
| `ses_e3a6d6540ffe…` | `ses_e3a72cac7ffe…` | manager  | 305  |
| `ses_e3a6d07efffe…` | `ses_e3a72cac7ffe…` | manager  | 353  |
| `ses_e3a6c0ca7ffe…` | `ses_e3a72cac7ffe…` | manager  | 478  |
| `ses_e3a6b41d4ffe…` | `ses_e3a72cac7ffe…` | manager  | 589  |
| `ses_e3a6c9916ffe…` | `ses_e3a72cac7ffe…` | devops   | 422  |
| `ses_e3a6c19afffe…` | `ses_e3a72cac7ffe…` | devops   | 465  |
| `ses_e3a6b75ffffe…` | `ses_e3a72cac7ffe…` | devops   | 552  |
| `ses_e3a6b55a0ffe…` | `ses_e3a72cac7ffe…` | engineer | 557  |
| `ses_e3a6b517cffe…` | `ses_e3a72cac7ffe…` | engineer | 559  |
| `ses_e3a6ae42effe…` | `ses_e3a72cac7ffe…` | engineer | 697  |

**关键观察**：`parentID` 字段上，**所有** manager / engineer / devops 会话都挂在根会话
`ses_e3a72cac7ffe…` 下，而不是挂在彼此的会话下。但事件流里的
`ChildWorkVoided.ParentSessionId` 指向 `ses_e3a710712ffe…`（manager 会话）：

```json
{
  "ParentSessionId": ["SessionId", "ses_e3a710712ffeNGxh8OC30OLxpF"],
  "Work": {
    "ChildSessionId": ["SessionId", "ses_e3a6b517cffey6bzm5VcvTiKV0"],
    "Handle": ["Agent", ["AgentHandleId", "ddkf4r"]]
  }
}
```

即「provider 层的 `parentID`」与「工作归属的 `ParentSessionId`」是两套口径，
本仓无法判定哪一套代表语义上的委派父级。**这一点需要上游澄清**，
本单不据此下任何归因结论。

另外，5 个 `ManagerJobCreated` 中只有 `qxcr5a` 能找到对应的 `ChildWorkVoided` 记录，
其余 4 个没有显式的子工作作废记录——现有证据不足以说「每个 manager 都派了子任务」。

### `Cancelled` 是单次尝试的终态，不是会话死亡

`Terminal` 事件统计：

| Disposition | Role         | 条数 |
| :---------- | :----------- | :--- |
| `Completed` | manager      | 14   |
| `Cancelled` | manager      | 5    |
| `Cancelled` | engineer     | 5    |
| `Cancelled` | orchestrator | 1    |

注意：`Cancelled` 的 5 条 engineer 记录对应**不止 5 次会话尝试**，且取消之后仍有新的
`stream ... agent=engineer`（`hosted-stderr.log:779`，13:11:08）。
因此不能写成「engineer 被取消所以交付失败」——它是每次 work 尝试的终态标记。

## 工作树实际改动

5 个委派工作树里只有 `#1` 与种子不同：

```
#1: lib/discount.mjs, lib/tax.mjs  ← 改了
#2 #3 #4 #5                        ← 与种子完全一致
```

`#1` 的 `lib/tax.mjs` 对照：

```diff
 export function addTax(cents, bps) {
-  return Math.floor((cents * bps) / 10000);
+  return cents + Math.floor((cents * bps) / 10000);
 }
```

即模型补上了缺失的 `cents +`，但舍入方式沿用了种子里的 `Math.floor`。
**本仓不对「是否跑过测试」下判断**：`Math.floor` 本来就是种子原状，
所以 `node --test` 得到 `927 !== 928`（3 过 1 挂）这件事，
无法区分「跑过但没改对」与「没跑过」。这里只记录改动内容本身。

## 三次复现的一致性

| 运行                      | 归因      | 载荷         | 工作树           | orchestrator 工具调用 | 终止形态               |
| :------------------------ | :-------- | :----------- | :--------------- | :-------------------- | :--------------------- |
| `20261110-210204157-k428` | `HARNESS` | 171 条，完整 | 5 个，1 个改文件 | 44 行                 | 543s `SIGKILL`，未超时 |
| `20261110-211452124-2umd` | `CONTEXT` | 80 条，完整  | 0 个             | —（更早停掉）         | 600s `SIGTERM`，超时   |
| `20261110-211525858-zlx2` | `HARNESS` | 194 条，完整 | 6 个，1 个改文件 | 40 行                 | 415s `SIGKILL`，未超时 |

`k428` 与 `zlx2` 独立一致：orchestrator 大量调用、manager 0 次、改动停在委派分支。
三次 `materials_mutated` 均为 `false`，载荷采集均 `completed=true`、
`errors`/`notes` 全为 0。

## 请求上游确认

1. **`join` 的返回是否把委派结果带回给调用方？**
   `k428` 在 13:10:29 发 `join` 后零工具调用、34 条 stream，最终 `WorkStillActive`。
   请确认这是「结果未回传」还是「模型收到后不再行动」。

2. **`retention` 用尽后强制 `resetScope`，是否会丢失委派上下文？**
   `RequestProjection.fs:691-711` 在 `remaining = 0` 时要求 `scope.kind = resetScope`。
   模型照做后即停摆。请确认 `resetScope` 的语义边界。

3. **`todowrite-for-orchestrator` 的能力边界是否在工具描述里说清了？**
   模型 44 次调用里大量在试 `import('fs/promises')`、`require`、`this.call`、`this.fs`。
   若 orchestrator 本就不该碰文件，工具 prose 是否应显式写「本工具无文件系统访问，
   读文件请用 X」？

4. **`ChildWorkVoided.ParentSessionId`（manager 会话）与 engineer 创建日志里的
   `parentID` 为何不是同一个 id？** 两者语义差异请澄清。

## 复现方式

```bash
PROCTOR_CAPTURE_EVENT_PAYLOADS=1 npm run proctor -- run \
  --dataset paired-on-effect-smoke --environment hosted-plugin-v1 \
  --project examples/product-eval --only paired-task-157.r1.on
```

| 产物                     | 看什么                                                            |
| :----------------------- | :---------------------------------------------------------------- |
| `hosted-run.json`        | `timed_out` / `host_signal` / `duration_ms` / `materials_mutated` |
| `hosted-stderr.log`      | `⚙` 行的工具调用序列；最后一次调用之后是否还有工具调用            |
| `hosted-stdout.log`      | 模型自述，含 `retention` / `commission` / `join` 的说明           |
| `event-store.json`       | `ManagerJobCreated` / `WorktreeCreated` / `Terminal` 角色分布     |
| `delegated-worktrees/*/` | 哪个工作树改了文件（与 `bank/materials/PAIRED-TASK-157` 比对）    |

## 附：本单修正了哪些早期误判

写单过程中被独立审查打穿三次，如实记录，避免向上游传递错误信息：

| 早期说法                                      | 为何错                                                                                  | 现在的说法                                     |
| :-------------------------------------------- | :-------------------------------------------------------------------------------------- | :--------------------------------------------- |
| 「manager 工具面缺写入/执行，转派入口不存在」 | 漏了 `devops`（有 `Write`/`Exec`）；也误把「宿主未注册 fork」推成「编程面 fork 不可用」 | 委派链是通的；`commission` 返回 `commissioned` |
| 「编排链上没有任何会话具备改文件→跑测试」     | `devops` 有 `Write` + `Exec`，能力齐全                                                  | 能力存在，但未被这条链路用上                   |
| 「orchestrator 是 75 次**调用**」             | 75 是字符串出现数，实际工具调用 44 行                                                   | 已改为 44 行，并注明口径                       |
| 「engineer 全部 Cancelled 所以交付失败」      | `Cancelled` 是单次 work 尝试终态，取消后仍有新 stream                                   | 只列事实，不据此归因                           |
| 「`floor` 说明没跑过测试」                    | `Math.floor` 是种子原状，该结果无法区分「跑过没改对」与「没跑过」                       | 只记录改动内容，不下此判断                     |

本仓对应动作：清播种目录前把工作树副本抄进产物，并在 `hosted-run.json` 里给出
`delegated_worktrees` / `delegated_changed_files` / `stranded_in_worktree` 三个字段，
便于判定「改动是否停在委派分支」。详见
[07-wanxiangshu-commission-bug.md](../process/07-wanxiangshu-commission-bug.md)。

跨仓引用只读，未修改上游任何文件。
