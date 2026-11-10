# BUG-20261109：deadline 回收进程树时 `kill(-1)` 向当前用户所有进程广播

- 严重级别：P0（可杀死整台会话里所有用户进程，包括编辑器与终端）
- 状态：已修复
- 发现时间：2026-11-09 02:07 起持续复现，2026-11-09 02:33 定位并修复
- 影响面：本机所有 GUI App（Cursor / WorkBuddy / 终端 / Finder 助手等），表现为「App 启动后 18–63 秒内全部辅助进程被 SIGTERM 杀掉」

## 症状

1. Cursor 每次启动后 18–63 秒，`main.log` 出现一整批：

   ```
   [error] [UtilityProcess id: N, type: extensionHost, pid: X]: crashed with code 15 and reason 'killed'
   [error] [UtilityProcess type: shared-process, pid: ...]: crashed with code 15 and reason 'killed'
   [error] CodeWindow: renderer process gone (reason: killed, code: 15)
   ```

2. 窗口被重载后 `agent_host_bridge_unavailable`、`No Connect transport provider registered`，
   Composer 每次发问都弹 `An unexpected error occurred`。
3. 同一时刻终端、Finder 辅助进程、WorkBuddy 渲染进程也被杀（同一用户下所有进程）。
4. 长任务（如跑 10 分钟的 Python 脚本）会无缘无故收到 SIGTERM 退出。

## 根因

`src/run/hosted-runner.ts` 的 deadline 路径：

```ts
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
  try { process.kill(-pid, signal); } catch { child.kill(signal) }
  ...
}
```

`process.kill(-pid)` 的语义是「把信号发给 pgid = pid 的整个进程组」。
**当 pid === 1 时，`-pid` 就是 `-1`，POSIX 语义为「发给当前用户能发的所有进程」**，于是整台会话被广播 SIGTERM，500ms 后再广播一次 SIGKILL。

触发链：

1. `tests/run/hosted-runner-timeout-workspace.test.ts` 用 `vi.mock('node:child_process')`
   伪造宿主进程，假 child 写着 `pid: 1`；
2. 用例把 `deadline_ms` 压到 150ms 并让宿主「hang」；
3. 定时器 150ms 后触发 → `reapTree` → `process.kill(-1, 'SIGTERM')` → 全用户广播；
4. 跑测试的编辑器自身也在广播范围内 → 渲染进程/扩展宿主/共享进程被 SIGTERM（退出码 15）→ 窗口崩溃重载；
5. Cursor 重载后自动续跑被打断的 agent 任务（`glass-auto-continue`），于是**再次运行同一个测试、再次广播**，形成自噬死循环。

副产品：Cursor 的 agent-harness 因 `crash_loop` 被自动回退并写入
`agent-harness/reverted.json`（generation `d87c6d…`，2026-11-08T14:13:22Z），
后续启动只能走 static floor。

## 修复

1. `src/run/hosted-runner.ts` `reapTree`：`pid <= 1 || pid === process.pid || !Number.isInteger(pid)`
   时只对 child 单进程 `child.kill(signal)`，绝不发组信号。
2. `apps/console/job-queue.ts` `terminateChildProcessTree`：同一守卫。
3. `src/security/isolation-backend.ts` `runProcessGroup`：同一守卫。
4. `tests/run/hosted-runner-timeout-workspace.test.ts`：假 child 的 pid 由 `1` 改为 `987_654`。

## 验证

```
npx tsc --noEmit -p .          # 通过
npx vitest run tests/run/hosted-runner-timeout-workspace.test.ts
# ✓ 6 tests passed (11.87s)，运行期间无任何进程被杀
```

Cursor 重启后新会话 `20261109T023402`：

- `crashed with code 15` 计数 **0**
- `No Connect transport provider` 计数 **0**
- `agent_host_bridge_unavailable` 计数 **0**
- `Created agent host and registered provider (timeToBridgeRegisterMs: 397)`

## 教训 / 防回归

- 任何 `process.kill(-pid, sig)` 都必须先断言 `pid > 1`，且拒绝自身 pid。
- 测试桩里不要用 `pid: 1` / `pid: 0` 当占位值，用高位无效 pid（如 `987_654`）。
- `kill(-1)` 的破坏半径等于「当前用户全部进程」，只靠 catch 兜不住——它不会抛错，只会成功。
