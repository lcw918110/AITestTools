# 复盘：2026-11-09 Cursor「无法工作」事件

> 一句话结论：**AITestTools 的一个 vitest 用例把假进程的 PID 写成 1，超时回收时 `process.kill(-1, SIGTERM)`
> 向当前用户全部进程广播；Cursor 自己也在广播范围内，被杀后又自动续跑同一个测试，形成自噬死循环。**

关联缺陷记录：`BUG-20261109-kill-minus-one-broadcast.md`

---

## 1. 影响面

| 对象      | 表现                                                                                                                                                                                                                         |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cursor    | 每次启动 18–63 秒后，渲染进程 + 全部扩展宿主 + shared/mcp 进程同时 `crashed with code 15`；窗口重载后 `No Connect transport provider` / `agent_host_bridge_unavailable`，Composer 每次提问弹「An unexpected error occurred」 |
| WorkBuddy | 渲染进程被同一波信号带走，会话中断、选项点击后直接停住                                                                                                                                                                       |
| 其它      | Terminal、Finder 辅助进程、ToDesk 等在同一瞬间被命中                                                                                                                                                                         |
| 长任务    | 跑几分钟以上的脚本会莫名收到 SIGTERM                                                                                                                                                                                         |

误判成本：连续两轮把矛头指向清理程序和 WorkBuddy，修复无果，Cursor 依旧不可用。

---

## 2. 时间线

| 时刻                        | 事件                                                                                       |
| --------------------------- | ------------------------------------------------------------------------------------------ |
| 11-06 01:59                 | `hosted-runner-timeout-workspace.test.ts` 最后修改                                         |
| 11-06 06:45                 | 该 Cursor 会话首次出现 `agent_host_bridge_unavailable`（早于任何清理动作，说明与清理无关） |
| 11-08 14:13:22Z             | agent-harness 因 `crash_loop` 被自动回退，写入 `reverted.json`                             |
| 11-08 20:54 – 22:31         | Cursor 连续 5 次启动，5 次在 18–63 秒内被杀                                                |
| 11-09 01:02 / 01:53 / 01:55 | 同上                                                                                       |
| 11-09 02:07                 | 本次会话：10 个辅助进程在 02:07:31.7–32.1 被一次性 SIGTERM                                 |
| 11-09 02:20 – 02:33         | 重新取证、定位到被自动续跑的 vitest 任务、找到 `kill(-1)`                                  |
| 11-09 02:33                 | 三处 `kill(-pid)` 加守卫 + 测试假 PID 改为 `987_654`，测试 6 passed                        |
| 11-09 02:34                 | Cursor 重启，`code15=0 / bridge=0 / No Connect=0`                                          |
| 11-09 08:41                 | 复核：同一主进程存活 6 小时，无新增崩溃                                                    |

---

## 3. 排查路径（哪一步才有效）

有效的一步是**从应用自己的日志反推"当时在跑什么"**：

1. `~/Library/Application Support/Cursor/logs/<会话>/main.log` → 拿到精确到毫秒的批量退出时刻与退出码 15。
2. 同目录 `window*/exthost/anysphere.cursor-agent-host/*.log` → 看到 bridge 注册过程，以及
   `turn -> ... model=lazy/task` 与 `shell stream: approval gate allowed command`，
   即**崩溃前 1.9 秒，agent 刚自动批准并执行了一条 shell 命令**。
3. 到 `state.vscdb` 里按 `bubbleId:<会话>` 前缀做**索引区间扫描**（114 GB 全表扫会超时，
   但 key 上有唯一索引，前缀区间只读索引），取出该 `toolCallId` 的气泡 → 命令原文就是那条 vitest。
4. 读被测代码：`reapTree()` → `process.kill(-pid, signal)`，测试桩 `pid: 1`。闭环。

两次无效的弯路（记录下来避免重犯）：

- **弯路一：怪清理程序。** 审计显示 `old_sessions: 0`、885 条会话与备份 1:1、`integrity_check ok`，
  且 11-06 就已经有同样的 bridge 报错。
- **弯路二：怪 WorkBuddy 的 `kill(-1)`。** 代码里确实有该缺陷（`killProcessGroupTreeSync` 只挡 `>0`），
  也确实能被触发，但**本次**日志里的发送者是 `node[PID]` —— 那是 vitest 进程。真凶在自家仓库里。
  → 教训：`node[PID]` 不等于 WorkBuddy，先查清楚这个 node 在跑什么再下结论。

工具限制（本次踩过）：

- `/bin/ps` 和 `osascript` 在本沙箱被拦（`operation not permitted`），进程枚举必须用 libproc
  （`proc_listallpids` / `proc_pidpath` / `proc_pidinfo`），工具见 `dirtidy/.diag/procwatch.py`。
- 单条命令超过 120 秒会被工具层 SIGTERM，长扫描要拆片。

---

## 4. 根因（代码级）

```ts
// src/run/hosted-runner.ts
const timer = setTimeout(() => {
  timedOut = true;
  reapTree(child, 'SIGTERM');
  forceKillTimer = setTimeout(() => reapTree(child, 'SIGKILL'), 500);
}, opts.timeoutMs);
```

```ts
function reapTree(child, signal) {
  const pid = child.pid;
  if (pid === undefined) return;
  try {
    process.kill(-pid, signal);
  } catch {
    child.kill(signal);
  }
  for (const d of collectDescendantPids(pid)) process.kill(d, signal); // pid=1 → 会遍历 launchd 的所有子进程
}
```

`process.kill(-pid)` 的语义是「发给 pgid = pid 的整个进程组」。`pid === 1` 时 `-pid` 即 `-1`，
POSIX 定义为「发给当前用户可发送信号的全部进程」。**它不会抛错，只会成功**，所以 catch 兜不住。

触发条件由测试提供：假 child `pid: 1` + `deadline_ms: 150` + 宿主 `hang`。

死循环：Cursor 被杀 → 重载 → `glass-auto-continue` 续跑被打断的 agent 任务 → 再跑同一个测试 → 再广播。

---

## 5. 修复

| 文件                                                    | 改动                                                                              |
| ------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `src/run/hosted-runner.ts` `reapTree`                   | `pid<=1 \|\| pid===process.pid \|\| 非整数` 时只 `child.kill(signal)`，不发组信号 |
| `apps/console/job-queue.ts` `terminateChildProcessTree` | 同一守卫                                                                          |
| `src/security/isolation-backend.ts` `runProcessGroup`   | 同一守卫                                                                          |
| `tests/run/hosted-runner-timeout-workspace.test.ts`     | 假 pid `1` → `987_654`                                                            |

## 6. 验证

```
npx tsc --noEmit -p .                                          # 通过
npx vitest run tests/run/hosted-runner-timeout-workspace.test.ts
#   ✓ 6 tests passed (11.87s)，期间无任何进程被杀
```

Cursor 新会话 `20261109T023402`：`crashed with code 15` = 0、`No Connect transport provider` = 0、
`agent_host_bridge_unavailable` = 0，`Created agent host and registered provider (397ms)`；
主进程连续存活 6 小时无新崩溃。

---

## 7. 可复用的规则

1. 任何 `process.kill(-pid, sig)` 必须先断言 `pid > 1` 且不等于自身 PID。
2. 测试桩不要用 `pid: 1` / `pid: 0` 当占位值，用高位无效 PID。
3. 杀进程树的函数应把「拒绝广播」写成显式分支，而不是依赖异常兜底 —— `kill(-1)` 不抛错。
4. 排查"进程被杀"时，第一步永远是确认**信号发送者是谁**（`sent by <proc>[pid]`），
   再确认那个进程当时在跑什么，最后才看它属于哪个产品。

## 8. 遗留（与本次无关，建议另行处理）

- `state.vscdb` 已 114 GB（29.9M 页，4 张表）。本次崩溃与它无关，但继续增长会影响启动与 diff 速度。
- `agent-harness/reverted.json` 中的 generation `d87c6d…` 仍在 24 小时回退期，Cursor 暂时走
  static floor，属正常降级，无需干预。
- AITestTools 有 3 处改动待提交（与其它脏文件混在一起，建议单独 `git add`）。
