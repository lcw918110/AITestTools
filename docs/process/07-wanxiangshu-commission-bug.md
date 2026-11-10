# `commission` 恒返回 `placement-failed`：根因已定案

## 结论

**根因不在万象术，在本仓 hosted 工作区。**

`commission` 失败的真实原因是 `RejectedDirty ("Worktree is dirty: opencode.json")`。
脏文件由 **opencode 自己**写入：它读到缺 `$schema` 的 `opencode.json` 时会补上这一行并落盘，
而本仓在 opencode 启动前刚把工作区提交成干净状态，于是这次补写立刻让工作区变脏，
万象术 `ChangeRuntime.start` 的脏检查随即拒绝建 manager 会话。

**本仓已修复**（`src/run/hosted-runner.ts` 播种配置时显式写 `$schema`）。

修复有效性的证据分两层，**必须分开看**：

| 层次                                 | 证据                                                                                                                                                  | 结论                                       |
| :----------------------------------- | :---------------------------------------------------------------------------------------------------------------------------------------------------- | :----------------------------------------- |
| 机制层（已证实）                     | 独立临时目录最小复现：缺 `$schema` 时 opencode 启动后 `git status` 出现 `M opencode.json`；预置 `$schema` 后 `porcelain` 为空                         | 补写机制与修复方向成立                     |
| 端到端层（**部分证实**，2026-11-05） | `runs/20261105-135851245-syv0` ON 侧 EventStore 出现 4 个 `ManagerJobCreated`、`WorktreeCreated`、`TerminalOutputCaptured`，全程 `RejectedDirty` 零次 | 脏检查不再拦截，**manager 会话确实被创建** |

**不能据此说「委派链路完全打通」**：该次 `timed_out=true`、`materials_mutated=false`、
`pass_token_present=false`，没有 `commission` 返回 `{ok:true}` 的回执，也没有 manager
真正改完文件的证据。准确表述是「委派已建立，闭环未完成」。

2026-11-09 `runs/20261109-205719419-4v1i` 在角色校正后再证实同一结论，并且比 `syv0` 更进一步：
ON 侧不仅有 `ManagerJobCreated`，stderr 还出现 manager、engineer、devops 三类会话；
600s 打满后文件仍未改。本次没有 `WorkStillActive` 字样。`placement-failed` 不是这次的失败码。

端到端那次超时**原因不是脏检查**：4 个 manager 会话并行跑 LLM 流，240s deadline 不够。
日志末尾仍在 `llm runtime selected` / `stream`，说明模型在正常干活。

早期结论里「`paired-task-160` OFF 侧首次通过」是错的：修复前的运行
`runs/20261104-102928596-fyci` 中 OFF 侧就已经 `pass=true`。
**且该次 OFF 侧产物 `plugin` 字段同样是 `.../Plugin.js`**——OFF 侧实际也挂了插件，
所以它既不能证明 `$schema` 修复有效，也不能当「无插件基线」。

「`RejectedDirty` 归零」在 `runs/20261105-093128823-gr38` 那次不成立：该次缺
`dist/OpenCode/Plugin/Plugin.js`，插件根本没被调用，脏检查路径压根没走到。
该结论现在由 `syv0` 那次运行重新证实（插件真实加载 + 脏检查零命中）。

**上游仍建议做一处改动**（非阻塞）：`Command.fs:1123` 的 `Error _` 把 `OrchestratorVerdict`
压成兜底码 `placement-failed`，让这个本可一眼看出的问题排查了整整两轮。

## 现象

orchestrator 调用 `commission` 委派 manager，**无论载荷如何**都返回：

```
ok=false, code=placement-failed
```

`horizon` 始终返回 `agents=[], ptys=[]`，委派从未真正建立。

## 根因定案过程

### 1. 兜底码掩盖了真实错误

`Command.fs:1123`：

```fsharp
| Error _ -> return Error "placement-failed"
```

`openManagerJob` 的实现（`Fork/OpenCode/Tool.fs:56-71`）把错误映射为 `HostError.Refused reason`，
`ForkManagerJob`（`Change/Host/Host.fs:680-711`）经 `mapForkManagerError`（`Host.fs:482-489`）
把 `OrchestratorVerdict` 转成 `sprintf "%A" verdict` —— **完整错误本来就在手边**，
只是被 `Error _` 丢掉了。

### 2. 本地探针拿到真实错误

在万象术仓把该行临时改成透传（`| Error reason -> Error (sprintf "placement-failed: %A" reason)`），
重新构建插件后跑 `paired-delegation-smoke`，orchestrator 侧立即读到：

```
Refused ("RejectedDirty ("Worktree is dirty: opencode.json")")
```

探针改动已还原，上游源码未留任何修改。

### 3. 脏文件来自 opencode 自身

`RejectedDirty` 的判定在 `ChangeRuntime.start`（`wanxiangli/src/change/ChangeRuntime.fs:104-108`）：
建 manager 会话前先 `isDirty repoPath`，非空即拒绝。

本仓此前已修过一轮「播种后未 commit」，`hosted-git-commit.json` 显示 `{ "ok": true }`，
播种后工作区确实是干净的。**变脏发生在 opencode 启动之后**。

最小复现（独立临时目录，不涉及本仓代码）：

```bash
git init --template= && git add -A && git commit -m seed   # 干净
opencode run --dir "$T" -m <model> --agent orchestrator "读取 README.md 后回复 OK"
git status --porcelain   # → M opencode.json
git diff opencode.json
```

差异只有一行：

```diff
 {
+  "$schema": "https://opencode.ai/config.json",
   "permission": {
     "*": "allow"
   },
```

opencode 1.19.4 在 reading config 阶段给缺 `$schema` 的配置补上该字段并写回磁盘，
发生在任何工具调用之前，因此必然早于 `commission`。

### 4. 修复验证

同一最小复现，配置里预置 `$schema` 后重跑：`git status --porcelain` 为空，
opencode 正常读到 `README.md` 并回复 `OK`。

## 本仓修复

`src/run/hosted-runner.ts` 播种 hosted 配置时显式写 `$schema`：

```ts
const cfg: Record<string, unknown> = {
  $schema: 'https://opencode.ai/config.json',
  permission: { '*': 'allow' },
};
```

回归测试 `tests/run/hosted-opencode-config-clean.test.ts` 两条：

| 用例                            | 断言                                                                     |
| :------------------------------ | :----------------------------------------------------------------------- |
| 播种后配置自带 `$schema`        | 播种后 `git status --porcelain` 为空；模拟 opencode 补写后仍为空         |
| 反证探针（缺 `$schema` 时变脏） | 人为删掉 `$schema` 重新提交，模拟补写后 `porcelain` 出现 `opencode.json` |

第二条是 Red 证据：把修复移除后第一条失败（`expected undefined to be 'https://opencode.ai/config.json'`），
恢复后两条全绿。

## 请求上游的改动（非阻塞，但强烈建议）

`Command.fs:1123`：

```fsharp
// 现在
| Error _ -> return Error "placement-failed"

// 建议
| Error reason -> return Error (sprintf "placement-failed: %s" reason)
```

或更彻底：给每个 `OrchestratorVerdict` 映射独立码（`rejected-dirty` / `integration-failed` / `cancelled` / `empty`）。

**代价**：一行。**收益**：`RejectedDirty` 这类环境问题不再需要改上游源码、重建插件才能定位。

## 已排除的假设

| 假设                                            | 排除依据                                                                                                                                                                                              |
| :---------------------------------------------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `HorizonTool.fs:49-51` 四个回调为 `None`        | `commission` 不经过 `HorizonTool`。`Fork/OpenCode/Tool.fs:124` 的 `orchestratorSpec` 把 `Command.Commission` 路由到 `ForkTool`；`HorizonTool` 只服务 `horizon` 只读名册（`ToolSurface.fs:1019-1041`） |
| `decode` 失败（`expected_tool_calls` 类型校验） | 省略 `name` 能返回 `name-required`，证明 `decode` 成功                                                                                                                                                |
| `calling` 校验失败                              | 非法 `calling` 返回 `unknown-calling`，与 `placement-failed` 不同                                                                                                                                     |
| 回调未接线（`1124`）                            | `Fork/OpenCode/Tool.fs:53-86` 全为 `Some(...)`                                                                                                                                                        |
| 播种后未 commit（第一轮修复）                   | 已修并验证 `{ "ok": true }`；本次真实原因是之后 opencode 的补写                                                                                                                                       |

## 实测证据

| 项                              | 值                                                               |
| :------------------------------ | :--------------------------------------------------------------- |
| 探针运行 ID                     | `examples/product-eval/runs/20261104-161903275-gs0t`             |
| 探针输出                        | `Refused ("RejectedDirty ("Worktree is dirty: opencode.json")")` |
| 修复后运行 ID                   | `examples/product-eval/runs/20261105-093128823-gr38`             |
| 修复后 OFF 侧                   | PASS —— **但 OFF 侧不加载插件，与 `$schema` 无关，不构成证据**   |
| 修复后 `RejectedDirty` 出现次数 | **未知**（该次缺 `Plugin.js`，插件未加载，脏检查路径未走到）     |
| 修复后 ON 侧                    | 仍超时，失败原因变为「未读到 EventStore」，而非脏检查            |

### 修复前后运行对照（同题 `paired-task-160`）

| 运行 ID                   | OFF 侧  | ON 侧   | 说明                                                   |
| :------------------------ | :------ | :------ | :----------------------------------------------------- |
| `20261104-102928596-fyci` | PASS    | HARNESS | **修复前** OFF 已通过，故「首次通过」不成立            |
| `20261105-093128823-gr38` | PASS    | HARNESS | 缺 `Plugin.js`，插件未加载，不能证明修复生效           |
| `20261105-102415379-xz8p` | CONTEXT | CONTEXT | 两侧均超时                                             |
| `20261105-132313486-fi09` | CONTEXT | HARNESS | 插件加载失败（npm 依赖 403），空转到 deadline          |
| `20261105-135851245-syv0` | CONTEXT | CONTEXT | **插件加载成功，委派建立成功**；因 deadline 不足仍超时 |

### 第二个真实缺陷：插件依赖装不上（已修）

`fi09` 那次 stderr 里有关键一行：

```
{"operation":"plugin-initialization-failed","result":"Failed to load OpenCode tool module: Cannot find package '@opencode-ai/plugin' imported from [REDACTED]"}
```

opencode 发现插件 import 的包在隔离 HOME 里解析不到，会后台跑 `npm install` 补装；
hosted 沙箱不放行 `registry.npmjs.org`，请求被代理以 403 拒绝，插件加载直接失败，
**被测插件一次都没被调用**，运行空转到 240s deadline 被 SIGKILL。

修法：`src/run/hosted-runner.ts` 的 `installPluginRuntimeDeps` 在播种隔离 HOME 时，
从插件自身包根向上找 `node_modules/@opencode-ai/plugin` 并复制进去，网络零参与。
**没有**选择放行 `registry.npmjs.org`——那等于允许被测模型在沙箱内下载任意包，边界太宽。

`syv0` 那次验证了修复效果：`ManagerJobCreated` 出现 4 次，插件加载成功。

**但预装并未让 opencode 认为依赖已满足**：该次 `hosted-stderr.log` 仍有 5 条
`background dependency install failed ... 403 ... @opencode-ai%2fplugin`。
说明 opencode 仍按自己的规则（可能是版本匹配或解析路径）判定需要安装。
这些重试是非阻塞的，插件已经加载成功，但「预装 = 依赖已满足」这个假设不成立，
后续若出现插件行为异常需回来查这条线。

另：`@opencode-ai/plugin` 自身声明了 `@ai-sdk/provider` / `@opencode-ai/sdk` /
`effect` / `zod` 等运行时依赖，且 `dist/tool.js` 直接 `import { z } from "zod"`。
只复制顶层包会让 Node 解析上溯失败，故 `installPluginRuntimeDeps` 按整棵依赖树复制。

## 影响面

| 能力                                   | 修复前     | 修复后                                             |
| :------------------------------------- | :--------- | :------------------------------------------------- |
| `commission`（orchestrator → manager） | 完全不可用 | 脏检查已排除，manager 会话确实被创建（闭环未完成） |
| 多智能体编排链                         | 完全不可用 | 待 deadline 与配对环境拆分收口                     |

## 外仓待办（只登记，本仓不改）

| 仓     | 待办                                                                | 证据                                                                                                                                                                                                                                                                                 | 本仓不做                             |
| :----- | :------------------------------------------------------------------ | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :----------------------------------- |
| 万象术 | 排查 manager 未完成交付及工作树未合回                               | `8q6x` 工作树改对但播种目录未改；`h65m` 600 秒超时，六个工作树中一个存在未提交修改，采集副本运行 `node --test tests/invoice.test.mjs` 四项通过；事件中未观察到发布或合回。已见模型调用不存在的接口，以及会话工具返回 `retention exhausted`，但尚不能确定单一根因或将其归责为工具缺陷 | 不改上游逻辑，不把工作树结果记为通过 |
| 万象术 | 供应商流被打断后，根会话要能继续委派，而不是以退出码 1 结束         | `runs/20261110-002235952-1bxk`：157–159 ON 均 `AI_InvalidResponseDataError`，无 `ManagerJobCreated`，文件未改。按现行口径是 `CONTEXT`，不能当成「没委派」                                                                                                                            | 不改编排提示，不改通过判定           |
| 万象术 | `Command.fs` 的 `Error _` 透传真实错误，不再压成 `placement-failed` | 本文件第 1 节                                                                                                                                                                                                                                                                        | 不改上游源码                         |
| 万象术 | agent 自身推理改中文                                                | `PairProgrammingThoughtTransform.fs` 只改注入指导语                                                                                                                                                                                                                                  | 不改被测推理语言                     |

本仓对应动作：清播种目录前，把 `WorktreeCreated` 路径下与播种材料同名的文件抄进该题产物 `delegated-worktrees/`。只留证据，不改变通过判定。诊断载荷采集见 [测试手册](../test/01-wanxiangshu-ops.md)「诊断」一节。

### `h65m` 的运行形态（不是进程崩溃）

| 观察                                                                | 证据                                                                                                         |
| :------------------------------------------------------------------ | :----------------------------------------------------------------------------------------------------------- |
| 宿主没有崩溃退出，是被 600 秒截止时间 `SIGTERM` 终止                | `hosted-run.json`：`timed_out=true`、`host_signal=SIGTERM`、`status=null`、`duration_ms=600046`              |
| 截止前会话仍在正常发请求，不是卡死                                  | `hosted-stderr.log` 末尾 `04:13:33` 仍在 `process`/`stream`，`04:13:35` 才结束                               |
| 日志中的 `error=Aborted` 是宿主主动取消，不是异常中断               | 每条 `Aborted` 前一行都是 `message=cancel`，对应同一 `session.id`                                            |
| `failed to subscribe`（FSEvents）在历史运行中同样出现，非本次新故障 | `1bxk`/`tgd3`/`p0g2` 各 3 次，`h65m` 仅 1 次；属环境噪声，不能单独当作根因                                   |
| 六个 Manager 工作树里只有一个真正改了材料                           | 采集清单 `states`：仅 `zb27lx` 为 `M lib/discount.mjs` / `M lib/tax.mjs`，其余均停在 `proctor seed` 且无改动 |

因此 `h65m` 的形态是：**模型在正常交互中把时间用完，而不是进程异常中断**。至于为什么没在截止前交付，现有证据只能说明「多次委派与协商消耗了时间、最后一次修改未提交也未发布」，还不足以断定是编排缺陷还是模型行为。

要分开这两种可能，下一次复现须带两样证据：

1. 委派工作树副本（始终采集，无需开关）：与播种材料同名的文件会抄进产物 `delegated-worktrees/`；
2. `PROCTOR_CAPTURE_EVENT_PAYLOADS=1`（需显式开启）：把事件里内联且摘要校验通过的载荷解码保存，附 `manifest.json`。

判读：若载荷里能看到 manager 已产出「改动完成」一类结论、而工作树仍未提交未发布，才可定性为编排交付环节缺失；若载荷里 manager 始终卡在工具调用或反复试错，则属模型行为，应由题面或提示约束解决，不动万象术业务逻辑。

### 复现 `k428`：已定性为管理器侧工具面缺文件编辑能力

`paired-task-157.r1.on`，`hosted-plugin-v1`，`paired-on-effect-smoke`，`PROCTOR_CAPTURE_EVENT_PAYLOADS=1`。结果 `0/1`，归因 `HARNESS`，`oracle discount-round` / `tax-round` 仍见原式。

采集清单完整：`completed=true`，`captured=171`，`missing` / `invalid` / `skipped` / `writeFailed` / `unreadEvents` / `errors` / `notes` 全为 0；5 个委派工作树的 `statusOk` 与 `logOk` 均为 true。因此下列判断不是缺证据下的推测。

| 观察                                                       | 证据                                                                                                                                                                                                                                                      |
| :--------------------------------------------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 改动已落到工作树，但**并不完全正确**：4 个测试里 3 过 1 挂 | `delegated-worktrees/1` 里 `discount.mjs` 为 `cents - Math.floor(...)`（对），`tax.mjs` 为 `cents + Math.floor(...)`（错，应为 `Math.round`）；`node --test` 实测 `927 !== 928`，`pass 3 / fail 1`                                                        |
| 该修复从未离开 manager 分支                                | 采集清单 `states`：`/tmp/claude/wanxiangshu-qxcr5a` 为 `## manager/qxcr5a` + 两个 `M`，`log` 只有 `proctor seed`；播种目录仍为 `## master`，未变                                                                                                          |
| 载荷里 manager 明确报告工具面缺文件编辑能力                | 40 条载荷命中「没有文件编辑 / 不提供文件编辑 / not a function / REVIEW_ONLY」，其中一条收尾报告逐条列出可用工具（`askPreviousScope`、`assume`、`horizon`、`join`、`negotiate`、`review`、`skill`、`todowrite-for-manager`、`web_search`），确认无写入工具 |
| manager 试图按手册转派但转不出去                           | 17 条载荷提到派 `Engineer`、29 条提到 `resume devops`；其中一条明确写 `this.write is not a function`、`this.commission is not a function`，并说明 `Engineer` 没有 bash、`devops` 需经 `resume` 才能执行                                                   |
| 22 条载荷写了「收尾报告 / 已完成」，但都停在汇报           | 报告内容是「方案正确、无法执行」，与工作树未提交、播种目录未变完全一致                                                                                                                                                                                    |

**结论**：不是 600 秒不够，也不是模型完全没想法——它写出了接近正确的补丁，但**拿不到能验证与提交的工具**，既没法跑测试发现自己把 `round` 写成了 `floor`，也没法把改动发布出去。属编排侧（万象术）缺陷，不是题面或模型单方面问题。

这条结论与 `h65m` 一致：两次都是「改动留在 manager 分支、播种目录未变」。差别是本次载荷补齐了原因，`h65m` 当时只能看到现象。

### 三次复现的稳定性（2026-11-10）

| 运行                      | 归因      | 载荷         | 委派工作树                           | 结论                                                                          |
| :------------------------ | :-------- | :----------- | :----------------------------------- | :---------------------------------------------------------------------------- |
| `20261110-210204157-k428` | `HARNESS` | 171 条，完整 | 5 个，1 个改了文件                   | `tax.mjs` 用 `floor`，测试 3 过 1 挂；`this.write` / `this.commission` 不存在 |
| `20261110-211452124-2umd` | `CONTEXT` | 80 条，完整  | **0 个**，未出现 `ManagerJobCreated` | 更早卡死：`this.devops is not a function`、`this.read is not a function`      |
| `20261110-211525858-zlx2` | `HARNESS` | 194 条，完整 | 6 个，1 个改了文件                   | 同样 `floor` 导致 927≠928；20 条载荷写了「收尾报告」                          |

三次都是 0/1，没有一次改动回到播种目录。前两次归因码不同（`CONTEXT` 是「超时且材料未改」的兜底，`HARNESS` 是判据自身所需文件缺失），但载荷指向同一处：**manager 侧工具面不全，写入、执行、转派三条路都断**。因此这不是偶发，也不依赖某个具体归因码。

**不在本仓修**：按「不改万象术业务逻辑」，本仓只负责把证据留全、把归因记准。上游需要做的是让 manager 会话拿到可用的写入/执行工具，或让 `commission` / `resume` 按手册真正可用。

### 交付面信号（不必再人工读载荷）

`hosted-run.json` 现在直接给出三个字段，用来判定「改动是否只停在委派分支」：

| 字段                      | 含义                                                                                                                   |
| :------------------------ | :--------------------------------------------------------------------------------------------------------------------- |
| `delegated_worktrees`     | 本次采集到几个委派工作树副本                                                                                           |
| `delegated_changed_files` | 副本里与播种时内容指纹不同的材料文件（含被删除的）                                                                     |
| `stranded_in_worktree`    | `true` = 有改动留在委派分支、播种目录对应文件未变；`false` = 改动都已回到播种目录；`null` = 未采成，**不能当作没搁浅** |

判定要点：

- `materials_mutated: false` 只说明播种目录没变，**不能**推断模型没干活。必须并看 `delegated_changed_files`。
- 按文件粒度判断：A 文件已交付、B 文件仍停在分支时仍记 `true`，不会被 A 掩盖。
- 工作树里删掉播种文件算改动，也计入搁浅。
- `null` 的来源：没有委派工作树事件、任一工作树采集出错（路径被拒 / 单文件读写失败 / 清单写失败 / 播种指纹缺 key）。任何一种都不能读成「确认没搁浅」。
- 副本始终采集；`stranded_in_worktree` 不参与通过判定，也不改写归因码——归因仍是既有封闭枚举，只多一份可判读的事实。

历史三跑回放：`k428` 与 `zlx2` 均为 `#1 changed=[lib/discount.mjs, lib/tax.mjs]` + `materials_mutated: false` → 搁浅；`2umd` 无委派副本，按新口径应为 `null`。

**复现命令**：

```bash
PROCTOR_CAPTURE_EVENT_PAYLOADS=1 npm run proctor -- run \
  --dataset paired-on-effect-smoke --environment hosted-plugin-v1 \
  --project examples/product-eval --only paired-task-157.r1.on
```

## 验证方法

```bash
npm run proctor -- run --dataset paired-delegation-smoke \
  --environment hosted-plugin-v1 --project examples/product-eval
```

修复成功的判据：

1. `commission` 返回 `{ ok: true, name, agentId, outcome: "commissioned" }`
2. EventStore 出现 `ManagerJobCreated` 事实
3. `horizon` 返回非空 `agents`
4. EventStore 出现第二个 session stream

本仓的 `paired-task-160` ON 侧已用 `event_subsequence: ["ManagerJobCreated"]` 锁死这个信号。
