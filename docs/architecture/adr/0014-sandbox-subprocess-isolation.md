# ADR-0014：沙箱包裹与宿主执行放进短命子进程

| 字段   | 值                            |
| :----- | :---------------------------- |
| 状态   | **已采纳**                    |
| 日期   | 2026-11-21                    |
| 决策人 | grill-me 对齐（用户「同意」） |

## 背景

`@anthropic-ai/sandbox-runtime` 的 `SandboxManager` 是**进程级单例**，并且：

1. `initialize()` 在 `initializationPromise` 已存在时静默返回，**忽略新传入的配置**（`sandbox-manager.js:790-795`）。
2. `initialize()` 内部 `startMuxProxyServer` 起本机代理，`wrapWithSandboxArgv` 返回的环境变量里写死 `HTTP_PROXY=http://localhost:<port>`（`sandbox-utils.js:723`）——**代理活在被包裹进程所在的进程里**。

批量跑卷时每道题有独立的工作区与隔离 HOME，现有实现只能在每次包裹前 `reset()` → `initialize(config)`，并用进程内串行锁 `wrapLockTail` 保证同一时刻只有一题在改配置（`src/security/sandbox-runtime.ts:64-90`）。这带来三个结构性后果：

- **吞吐被强制串行**：锁跨整个 `reset→initialize→wrap` 链，批量跑只能一题一题来。
- **可能永久挂起**：`reset()` 内部 `await` 各 server 的 `close()` 回调，若上一题的沙箱子进程留下半开连接（对端不回 FIN）则回调永不触发。实测 ON 侧全量跑第 72 题卡死 80+ 分钟。
- **只能靠兜底超时收场**：整链加 `SANDBOX_WRAP_TIMEOUT_MS`（默认 60s），超时按 HARNESS 抛出并跳过该题——这是补救，不是修复。

## 决策

**每道题起一个短命子进程，由它承担「包裹 + 执行」，结束后自行退出。**

1. **子进程职责**：`SandboxManager.reset()`（防御性，通常已干净）→ `initialize(config)` → `wrapWithSandboxArgv` → `spawn` 宿主 → 收集观测 → 回传结果 → 退出。代理与 Seatbelt profile 都在同一进程内诞生和消亡，语义天然正确。
2. **回传契约**：回传 `{ status, signal, error, stdout, stderr, timedOut, stdioDestroyed }`，与 `observeHostExit` 的入参一一对应。**不做实时流式转发**——子进程内的 `runAndReap` 边跑边收只用于拼接文本、计时超时与按字节解码，所有业务判断都发生在进程结束之后，结束时整包回传不改变任何判定语义。
3. **主进程删除项**：`wrapLockTail` 串行锁、`SandboxManager.reset()` 调用、`SANDBOX_WRAP_TIMEOUT_MS` 兜底超时。这些机制存在的前提是「全局状态要在同进程内复用」，前提消失后应一并删除，不留兼容分支。
4. **回传的 `sandboxEnv` 必须原样生效**：其中含沙箱必需的 `HTTP_PROXY` / `HTTPS_PROXY` / `ALL_PROXY` / `NO_PROXY` 与代理认证令牌。任何「剥离 http_proxy」的既有逻辑不得作用在子进程回传的这份 env 上；剥离只针对继承来的宿主环境，不针对包裹层产出的环境。
5. **包裹层自身故障归 HARNESS**：子进程被 OOM / 信号杀死、握手协议损坏、回传缺字段，都属工装故障，判负归 `HARNESS`，不得计入被测系统缺陷。
6. **旁路诊断同样走子进程**：`PROCTOR_SANDBOX_BYPASS=1` 只跳过包裹（请求里带 `sandboxBypass`），进程边界不变。若旁路退回主进程直接起宿主，进程树回收的误杀面就回到引擎进程本身，抵消本决策的主要收益。
7. **主进程不再保留第二套执行/回收实现**：`runHostedWithReap` 及其进程树回收、双阶段结算代码已删除，只保留在子进程里这一份；stdio 结算与 UTF-8 接线的回归随之迁到 `tests/security/`。唯一允许保留主进程侧「启动宿主」代码的理由已随旁路收敛而消失。
8. **不做长驻沙箱服务进程**：它能把代理跨题复用（省约 0.2s 冷启动），代价是把已经出过事故的「哪道题用哪份配置」协调逻辑从进程内搬到进程间——问题从「消灭」变成「重新实现」。批处理吞吐不构成足以承担该代价的收益。

## 后果

- 正面：全局状态串题在结构上不可能发生；串行锁与 `reset()` 卡死风险一并消失；一道题崩溃只影响该题，不再拖垮整批；进程树清理的误杀面从一个引擎进程缩到一个沙箱子进程。
- 负面：每题多一次 Node 冷启动（约 0.1–0.3s，相对数十秒的模型调用可忽略）；主进程只能拿到子进程退出后的整包结果，若将来出现「必须中途读流做决策」的需求，需要单独评审再引入转发通道（当前无此需求）。
- 不做：不改万象术业务逻辑；不把 156 全量当效果结论；不在本机没有对应操作系统时宣称该系统的子进程方案已验证。

## 相关

- `docs/02-总体架构与领域设计.md` §7.2
- ADR-0013（首期隔离后端只接 sandbox-runtime）
- `src/security/sandbox-runtime.ts`、`src/run/hosted-runner.ts`
