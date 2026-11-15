# 12 · SUT 形态抽象设计（宿主类 / 插件类 / 服务类）

> 状态：设计稿（2026-11-13）。本文回答「本仓要测的 SUT 从「OpenCode 插件」扩展到「独立常驻服务」时，哪些抽象需要建立、哪些能力已有、哪些必须新写」。
> 上游依据：[02-总体架构与领域设计.md](02-总体架构与领域设计.md) §1 架构原则 1「通用核心、被测对象专属适配」；[07-ExecutionAdapter统一状态机设计.md](07-ExecutionAdapter统一状态机设计.md) 8 阶段契约。
> 本文不替代 07；07 定义「一次 case 的 8 阶段生命周期」，本文定义「不同形态的 SUT 如何各自满足这 8 阶段」。

---

## 1. 目标与非目标

### 1.1 目标

1. 让本仓能测**三种形态**的 SUT，且新增一种形态时不需要改动领域层、指标层、报告层：
   - **插件类**：寄生于宿主进程的扩展（如 OpenCode 插件版万象术）
   - **服务类**：独立常驻进程 + 对外接口（如 Herdchestra）
   - **模型类**：直接调模型 API，无宿主无插件
2. 把「如何驱动」与「如何观测」从 `HostedAdapter` 内部拆出来，成为可声明、可复用的契约。
3. 保留现有插件类能力不退化。

### 1.2 非目标

1. **不追求「任意 SUT 零代码接入」**。形态差异（进程 vs 服务 vs API）必然需要各自的 adapter 实现；抽象的目标是让**差异被隔离在 adapter 内**，而不是消灭差异。
2. **不改被测系统的业务逻辑**（本仓硬规则）。需要被测系统配合的改动（如导出接口）只能提需求，不能代做。
3. **不重构 07 的 8 阶段契约**。本文验证该契约足以容纳三种形态；若发现不足，另立 ADR。

---

## 2. 事实基础（2026-11-13 实测）

### 2.1 两代万象术的真实差异

| 维度     | 插件版（本仓现在测的）                                                     | Herdchestra（独立版）                                                |
| :------- | :------------------------------------------------------------------------- | :------------------------------------------------------------------- |
| 仓库     | 外部 SUT，`SUT_ROOT` 指向                                                  | `/Users/Licw/Desktop/git/Herdchestra`                                |
| 语言     | TypeScript（OpenCode 插件）                                                | Clojure/JVM 服务端 + ClojureScript 客户端，492 个源文件              |
| 形态     | 宿主进程内插件                                                             | `pixi run app` 常驻单例服务                                          |
| 启动方式 | `opencode run` 子进程                                                      | `pixi run app`，浏览器访问                                           |
| 对外接口 | 无（宿主调用插件 hook）                                                    | `/chsk`（Sente）、`/blobs`、`/healthz`、**loopback control channel** |
| 事件存储 | git ref `refs/wanxiang/store` + `.Herdchestra/wanxiangshu/events/*.ndjson` | Datalevin（LMDB）+ `artifacts/` `worktrees/` `fleet/state.edn`       |
| 工作区   | 单 git 仓                                                                  | 多 worktree 并发 + STM 看板 + 写锁 W                                 |
| 隔离     | Seatbelt 包住子进程                                                        | 服务自身管理（`src/hc/client/sandbox/`）                             |
| 版本     | 0.8+（插件形态）                                                           | 0.0.4                                                                |

**关键事实**：Herdchestra 源码中 `opencode` / `plugin` / `refs/wanxiang` 出现次数均为 **0**。其 `HISTORY.md` 明确记载这是从「多宿主插件时期」演进到「Clojure/JVM 独立全栈」的**架构代际切换**，原因为「宿主寄生架构的根本瓶颈」（宿主私有 API 脆弱、单点上下文瓶颈、缺跨个体文件事务与写锁）。

**因此**：本文讨论的不是「同一 Host 下换 SUT 语义」（那种情况下参数化插件路径即可），而是**执行范式本身不同**。

### 2.2 Herdchestra 已有的可驱动面

这是决定方案形态的关键发现，**必须利用而非重造**：

| 能力                     | 实现位置                                   | 说明                                                                                          |
| :----------------------- | :----------------------------------------- | :-------------------------------------------------------------------------------------------- |
| loopback control channel | `src/hc/server/app.clj` `control-handler`  | EDN 行协议 + token 鉴权，注释明写「also used by external E2E drivers」                        |
| 支持的操作               | 同上                                       | `:ping` / `:focus-or-create` / `:create-session` / `:command`                                 |
| 指令投递                 | `:command` op，payload 为 EDN map          | 支持 `:session/create`、`:user/message`、`:session/close` 等                                  |
| endpoint 发现            | `<tmpdir>/herdchestra-<user>/instance.edn` | 含 `:port` 与 `:token`                                                                        |
| 现有 JS E2E              | `test/e2e/*.spec.mjs`（15,000 行）         | 已用该通道驱动，含 mock model、证据采集、Playwright UI 断言                                   |
| 可复用基建               | `test/e2e/support/`（3,233 行）            | `app.mjs`（启动）、`mock-model.mjs`（mock 模型）、`evidence.mjs`（证据）、`ui.mjs`（UI 断言） |

**结论**：驱动 Herdchestra 不需要新造协议，只需在 AITestTools 侧实现该通道的客户端。

### 2.3 现有 adapter 实现盘点

| adapter                                           | 形态   | 生命周期假设                 |
| :------------------------------------------------ | :----- | :--------------------------- |
| `L1Adapter`（`l1-runner.ts`）                     | 进程内 | 调 fold 函数                 |
| `L2Adapter`（`l2-runner.ts`）                     | 进程内 | 假宿主                       |
| `L3Adapter`（`l3-runner.ts`）                     | 进程内 | 读 cassette                  |
| `CAdapter`（`c-runner.ts`）                       | 子进程 | spawn shell                  |
| `BDirectAdapter`（`b-runner.ts`）                 | HTTP   | 调模型 API                   |
| `HostedAdapter`（`hosted-runner.ts`，约 1100 行） | 子进程 | spawn `opencode`，读 git ref |

**`HostedAdapter` 内部混了两层**：

1. **宿主交互**（对任何 OpenCode 插件型 SUT 通用）：写 `opencode.json`、隔离 HOME、装插件、Seatbelt 包裹、`$schema` 补丁
2. **SUT 语义**（万象术插件版专属）：`ChangeRuntime.start` 脏检查、`refs/wanxiang/store` 读取、`wanxiangshu.mjs` 调度器覆盖、`WorktreeCreated` 载荷解析

第 2 层是硬编码泄漏，但**它服务的 SUT 已是被替代的上一代**，改造收益有限（见 §6 决策 D3）。

---

## 3. 抽象设计

### 3.1 三种形态的共性抽取

把 8 阶段契约（07 §3.1）按形态展开，差异集中在 4 个位置：

| 阶段      | 插件类                    | 服务类                     | 模型类       | 差异本质           |
| :-------- | :------------------------ | :------------------------- | :----------- | :----------------- |
| `prepare` | 建隔离 HOME + 装插件      | 连接已有服务或拉起并等健康 | 无           | **资源获取方式**   |
| `submit`  | spawn 子进程 + prompt     | 投递指令到控制通道         | HTTP 请求    | **任务投递方式**   |
| `collect` | 读子进程 stdout + git ref | 查控制通道状态 / 读数据库  | 读 HTTP 响应 | **状态与事件来源** |
| `cleanup` | 杀子进程 + 删临时 HOME    | 关闭会话 / 回收 worktree   | 无           | **资源释放方式**   |

**共性**：四者都是「拿一个东西 → 让它干活 → 看它干得怎么样 → 还回去」。差异只在**通道**。

### 3.2 需要新增的两个契约

#### 契约一：`SutTransport`（SUT 通道）

把「怎么跟 SUT 说话」从 adapter 里抽出来，adapter 只负责编排阶段。

```typescript
/**
 * SUT 通道：屏蔽「进程 / 服务 / HTTP」三种形态的差异。
 * adapter 通过它投递任务与读取状态，不直接接触 spawn / socket / http。
 */
export interface SutTransport {
  readonly transportId: string;

  /** 建立通道（进程型=spawn；服务型=连接或拉起并等健康；HTTP=建客户端）。 */
  open(ctx: TransportContext): Promise<TransportHandle>;

  /** 投递一次任务，返回可用于后续查询的句柄。 */
  submit(handle: TransportHandle, task: SutTask): Promise<SutSubmission>;

  /** 查询当前状态（可多次调用，直到终态）。 */
  poll(handle: TransportHandle, submission: SutSubmission): Promise<SutStatus>;

  /** 读取事件流（形态各异：stdout / git ref / 数据库 / HTTP）。 */
  events(handle: TransportHandle, submission: SutSubmission): Promise<SutEvent[]>;

  /** 释放通道（进程型=kill；服务型=关会话；HTTP=无操作）。 */
  close(handle: TransportHandle): Promise<CloseResult>;
}
```

**为什么这样切**：`HostedAdapter` 里的脏检查、调度器覆盖、`$schema` 补丁，本质都是「为了让 `submit` 成功而做的准备」，属于 `SutTransport.open` 的职责，不属于 adapter 的编排逻辑。

#### 契约二：`SutObservation`（观测面声明）

不同 SUT 能提供的观测能力不同，必须**显式声明**，否则 oracle 会在「读不到」时静默放过（这是本仓反复强调要防的假绿）。

```typescript
/**
 * 观测能力声明：SUT 能提供什么，不能提供什么。
 * 未声明的能力，oracle 必须按 HARNESS 拒绝，不得静默跳过。
 */
export interface SutObservation {
  /** 事件流可用性。 */
  events: 'available' | 'partial' | 'unavailable';
  /** 工作区变更可观测性。 */
  workspace_changes: 'available' | 'partial' | 'unavailable';
  /** 工具调用可观测性。 */
  tool_calls: 'available' | 'partial' | 'unavailable';
  /** 模型用量可观测性。 */
  model_usage: 'available' | 'partial' | 'unavailable';
  /** 子代理/委派结构可观测性。 */
  delegation: 'available' | 'partial' | 'unavailable';
  /** 每项的来源说明（写进产物，便于人工核对）。 */
  notes: Record<string, string>;
}
```

**为什么需要**：Herdchestra 的观测面是 Datalevin + AG-UI，与插件版的 git ref 完全不同。若不声明，`no_event` 类 oracle 在 Herdchestra 上会因「读不到事件」而误判为「没有禁止事件发生」——**这是最危险的假绿**。

### 3.3 与现有 `ExecutionAdapter` 的关系

**不改 07 的 8 阶段签名**。adapter 在内部持有 `SutTransport`：

```typescript
export class HerdchestraAdapter implements ExecutionAdapter {
  readonly adapterId = 'b-hosted-herdchestra';

  async prepare(ctx: AdapterContext, discovered: DiscoveredInput): Promise<PreparedState> {
    const transport = new LoopbackTransport();          // 本 adapter 专属
    const handle = await transport.open({ /* ... */ });
    return { transport, handle };                        // 塞进 PreparedState
  }

  async submit(ctx: AdapterContext, prepared: PreparedState): Promise<SubmittedHandle> {
    const { transport, handle } = prepared as HerdchestraPrepared;
    const submission = await transport.submit(handle, { prompt: /* ... */ });
    return { transport, handle, submission };
  }

  // collect / evaluate / cleanup 同理
}
```

**这验证了 07 契约的健壮性**：8 阶段足以容纳服务型 SUT，不需要改契约。

---

## 4. 三种形态的落地清单

### 4.1 插件类（现状，不退化）

| 项                             | 动作                                                               |
| :----------------------------- | :----------------------------------------------------------------- |
| `HostedAdapter`                | **保留不动**。它是插件版万象术的完整实现，也是「插件类」的参考实现 |
| `plugin-path.ts`               | 保留。可选：把候选路径表改为读环境声明（低优先，见 §6 D3）         |
| `event-store.ts`               | 保留。同上                                                         |
| `examples/wanxiangshu-papers/` | 保留。作为插件类的回归基线                                         |

**唯一改动**：把 `HostedAdapter` 内部可复用的部分（隔离 HOME、Seatbelt 包裹、插件安装）抽成 `PluginHostTransport`，供未来其他插件类 SUT 复用。**这一步可选**，若近期不接第二个插件类 SUT，可以不做。

### 4.2 服务类（Herdchestra，新增）

| 项                       | 动作                                                                                         | 工作量         |
| :----------------------- | :------------------------------------------------------------------------------------------- | :------------- |
| `LoopbackTransport`      | 实现 Herdchestra 的 EDN 行协议客户端：读 `instance.edn` 拿 port/token、发 `:command`、收回复 | 中             |
| `HerdchestraAdapter`     | 实现 8 阶段：`prepare` 连服务、`submit` 投指令、`collect` 轮询状态、`cleanup` 关会话         | 中             |
| `HerdchestraObservation` | 声明观测能力：事件从哪读、工作区变更怎么拿、委派结构是否可见                                 | 中             |
| 事件读取                 | 黑盒：读工作区文件 + 控制通道终态；白盒需其配合（见 §6 D2）                                  | 中             |
| `examples/herdchestra/`  | 新建考卷库：environments 声明服务型 recipe、cases 定义任务                                   | 中             |
| 状态重置                 | 每个 case 跑完如何回到干净状态（它是「当前态持久化」，不像插件版可每次新开工作区）           | **高，需设计** |

### 4.3 模型类（已有，验证抽象）

`BDirectAdapter` 已实现模型类。**用它验证 `SutTransport` 抽象是否合理**：若模型类无法用 `SutTransport` 表达（因为无状态、无事件流），说明抽象过度，应退回「每种形态一个 adapter，不强行统一」。

---

## 5. 保留与清理

### 5.1 必须保留

| 内容                                                                                            | 理由                                                                                                                    |
| :---------------------------------------------------------------------------------------------- | :---------------------------------------------------------------------------------------------------------------------- |
| `examples/wanxiangshu-papers/`                                                                  | 插件类回归基线；Herdchestra `HISTORY.md` 明确把插件时期列为「被否决方案的反面教训」，保留才能量化「独立版是否真的更好」 |
| `src/run/hosted-runner.ts`                                                                      | 插件类参考实现                                                                                                          |
| `src/attribution/event-store.ts`、`plugin-path.ts`                                              | 插件类专用能力                                                                                                          |
| `examples/product-eval/`                                                                        | T6/T7 实验数据与 361 个真实产物                                                                                         |
| `docs/process/07-wanxiangshu-commission-bug.md`                                                 | 上游报障单                                                                                                              |
| `src/domain/`、`src/metrics/`、`src/report/`、`src/judge/`、`src/exam-engine/`、`src/security/` | 真通用，一行不改                                                                                                        |

### 5.2 可以清理

| 内容                                                    | 理由                                                           |
| :------------------------------------------------------ | :------------------------------------------------------------- |
| `apps/console/controllers/health.ts` 的「测万象术」文案 | 改为读环境声明的显示名                                         |
| `apps/console/run-plan.ts` 的 `'plugin'` 枚举           | 改为读环境的消融能力声明，避免「插件实验」隐含绑定「测万象术」 |

### 5.3 文档口径修正（优先做）

`docs/02-总体架构与领域设计.md` §1 原则 1 提到「万象术专属开关、状态和证据由 `VibeFsAdapter` 解释」，但**该类在代码中不存在**。实际是 6 个按执行层级划分的 adapter，万象术语义沉在 `HostedAdapter` 内。

按文档找代码会找不到，比没有文档更糟。**建议改为**：「万象术专属开关、状态和证据由 `HostedAdapter` 内部解释；跨形态的通道差异由 `SutTransport` 隔离（见 12）。」

---

## 6. 关键决策

### D1：Herdchestra 与插件版的关系

- **替换**：插件版归档（`lifecycle: deprecated`），`HostedAdapter` 保留但不再用于新实验
- **并存**：两套长期共存，`SutTransport` 抽象必须同时容纳
- **过渡**：先并存，验证 Herdchestra 跑通后再归档

**影响**：决定 §4.1 的「抽取 `PluginHostTransport`」是否值得做。

### D2：Herdchestra 的观测面怎么接（已定，2026-11-15）

**结论：黑盒优先，白盒需协作。** 这一项经过四轮实测修正，证据链如下。

#### 三条候选通道的实测覆盖度

| 通道                                          | 用户数据 | 执行事件     | 工作区变更   | 需它改代码     |
| :-------------------------------------------- | :------- | :----------- | :----------- | :------------- |
| 备份包（`:backup/create`，`--encrypt false`） | ✅       | ❌           | ❌           | 否             |
| 控制通道扩展查询 op                           | —        | ✅（需实现） | ✅（需实现） | 是（约 20 行） |
| 读 Datalevin（LMDB）                          | ✅       | ✅           | ❌           | 否             |

**备份包的边界**：`backup/model.clj` 的 `category-order` 只有十类用户侧数据——`[:conversations :assistants :connections :tools :skills :workspaces :worldbooks :memories :appearance :schedules]`。**执行事件、委派结构、看板终态、工具调用记录均不在其中。** 故备份包只能解决「用户数据快照」，解决不了「执行轨迹」。

**读 Datalevin 的产品态度**：`datalevin.clj` 源码注释明确写「A host that relies on the global pools without an open LMDB still loses them at this product's last close; **that sharing is unsupported**」。`offline.clj` 进一步说明「The application router refuses a live restore because it cannot prove that Owners and writers have stopped」。产品主动划定「活实例不给外部读全量状态」的边界。

#### 决定性证据：Herdchestra 自己怎么测自己

查其 15,000 行 E2E（`test/e2e/`）的断言依据：

| 断言什么         | 靠什么拿                                              |
| :--------------- | :---------------------------------------------------- |
| 模型收到什么注入 | mock model 自己记录请求体（`support/mock-model.mjs`） |
| 界面显示了什么   | Playwright 读 DOM（`shot` / `cardText` / `composer`） |
| 会话状态对不对   | UI 投影（`waitForSync` 后读界面）                     |
| 工作区改对没有   | 直接读工作区文件（普通 git 仓）                       |

**全仓 E2E 中没有任何一行读取 Datalevin 的代码。** 它作者完全有权限改代码、加接口，却选择「mock 外部依赖 + 读 UI + 读文件」三招解决全部断言。

**这说明「把内部执行轨迹暴露给外部」不在它的产品设计里**——它自己测自己都只断言外部可观测结果，不断言内部编排结构。

#### 一个必须先回答的问题

AITestTools 想断言的东西，与 Herdchestra 自己测的东西不在同一层：

|        | Herdchestra 测自己                               | AITestTools 若测白盒                       |
| :----- | :----------------------------------------------- | :----------------------------------------- |
| 断言层 | 黑盒（模型收到什么、界面显示什么、文件改成什么） | 白盒（几个子代理、看板怎么流转、委派层级） |
| 依据   | mock + UI + 文件                                 | 需要内部事件                               |

**这个答案不在代码里，在评测目标里。** 若目标是建立跨形态的通用抽象（宿主类 / 插件类 / 模型类），黑盒契约对所有形态都成立，是更合适的起点；白盒契约每换一个 SUT 都要重谈。

#### 方案排序

| 序  | 方案                                                            | 前提           | 评价                                                                              |
| :-- | :-------------------------------------------------------------- | :------------- | :-------------------------------------------------------------------------------- |
| 1   | **黑盒三招**：mock 外部依赖 + 读工作区文件 + 读控制通道/UI 终态 | 无需它改代码   | 与其自身 E2E 同构，已被证明可行。局限：测不了内部编排结构                         |
| 2   | 扩展控制通道只读 op                                             | 需它改约 20 行 | 能测白盒；符合产品边界（控制通道本就是给外部 driver 用的）；对其自有 E2E 也是净增 |
| 3   | 备份包导出                                                      | 无需改代码     | 只覆盖用户数据，测不了执行轨迹，仅作补充                                          |
| 4   | 读 Datalevin                                                    | 无需改代码     | 产品明确拒绝，且其自身 E2E 无先例，**不作主路径**                                 |

**取舍原则**：先做方案 1（零侵入、可立即开始、覆盖大部分评测价值）；只有当「必须断言委派层级/看板流转」这类白盒需求被确认时，才向 Herdchestra 提方案 2。方案 3 作补充，方案 4 排除。

### D3：`HostedAdapter` 的硬编码是否参数化

- **不参数化**：接受「插件版专属」，接第二个插件类 SUT 时复制一份
- **参数化**：抽 `PluginHostTransport` + 环境声明，成本约 10 个模块改动

**影响**：若近期只接 Herdchestra（服务类），参数化收益低；若要接多个插件类 SUT，则必要。

### D4：状态重置语义（已降级为待实测）

**这不是设计问题，是性能问题。** 需先厘清两个不同维度：

|          | Herdchestra 的「当前态持久化」               | 测试需要的「干净环境」                 |
| :------- | :------------------------------------------- | :------------------------------------- |
| 解决什么 | 大规模协作下的存储与重放成本（它内部的问题） | 测试之间的状态污染（我们的问题）       |
| 手段     | 折叠历史、只留当前态                         | 独立 `--data-dir` + `--workspace-root` |

两者不在同一层面。**它的历史折叠不但不阻碍测试隔离，反而有利**：数据目录相对小，复制与删除都快，不存在「历史越积越多导致测试变慢」。

它已原生支持隔离（`RUNNING.md`）：`--check` 模式会在隔离数据目录启动完整系统，代码中显式传入 `--data-dir <root>/data` 与 `--workspace-root <root>/work`。

**待实测项**：起一个完整 JVM 实例需要多久。若 10 秒以上，几百个 case 就跑不动，那时才需要考虑「复用实例 + 关会话重置」；否则「每 case 一实例」是最干净的方案。

---

## 7. 实施顺序建议

| 序  | 步骤                                                             | 验收                                          |
| :-- | :--------------------------------------------------------------- | :-------------------------------------------- |
| 1   | 修 `docs/02` 的 `VibeFsAdapter` 口径                             | 文档与代码一致                                |
| 2   | 定 D1（替换/并存/过渡）                                          | 有明确答案                                    |
| 3   | 实测「起一个 Herdchestra 实例耗时」                              | 决定 D4 走「每 case 一实例」还是「复用+重置」 |
| 4   | 实现 `LoopbackTransport`（只做 ping + create-session + command） | 能连上 Herdchestra 并投递一条指令             |
| 5   | 实现 `HerdchestraAdapter` 的 `prepare` + `submit`                | 能跑通一个最小 case（不判定，只看是否执行）   |
| 6   | 实现黑盒采集：读工作区文件 + 控制通道终态                        | 能读到执行结果（D2 方案 1）                   |
| 7   | 实现 `evaluate` + `cleanup`                                      | 完整 8 阶段跑通                               |
| 8   | 用 `BDirectAdapter` 验证 `SutTransport` 抽象是否过度             | 若过度，退回「每形态一 adapter」              |

**第 8 步是自我证伪**：如果模型类无法用 `SutTransport` 表达，说明这个抽象只适用于「有状态的 SUT」，应明确写进文档而不是强行统一。

**暂不做的事**：白盒观测（D2 方案 2）需先确认评测目标确实要求断言内部编排结构，再向 Herdchestra 提需求。

---

## 8. 风险

| 风险         | 说明                                                       | 缓解                                                                 |
| :----------- | :--------------------------------------------------------- | :------------------------------------------------------------------- |
| 白盒需求成立 | 若最终必须断言委派层级/看板流转，黑盒采集不够用            | 向 Herdchestra 提「控制通道只读 op」需求（约 20 行，符合其设计用途） |
| 状态无法重置 | 若实例启动过慢，逐 case 起实例不现实                       | 先实测耗时（§7 第 3 步）；必要时改「复用实例 + 关会话」              |
| 抽象过度     | `SutTransport` 可能只适用于有状态 SUT                      | 用 `BDirectAdapter` 做证伪（§7 第 8 步）                             |
| 插件版退化   | 抽取 `PluginHostTransport` 时改坏 `HostedAdapter`          | 现有 1014 个测试是回归网；每步改动后全量跑                           |
| 单例冲突     | Herdchestra 是「每台机器单一常驻进程」，并发跑 case 会撞锁 | 独立 `--data-dir` + `--workspace-root` 隔离多实例                    |

---

## 9. 与既有文档的关系

| 文档            | 关系                                                                |
| :-------------- | :------------------------------------------------------------------ |
| 02 §1 原则 1    | 本文是其落地设计；同时修正其中 `VibeFsAdapter` 的失实描述           |
| 07 §3.1         | 本文验证 8 阶段契约足以容纳服务型 SUT，不改契约                     |
| 05 领域对象映射 | 新增 `SutTransport` / `SutObservation` 需登记到 05                  |
| 04 实验方案     | 服务类 SUT 的 ON/OFF 对照语义待定（Herdchestra 无「插件开关」概念） |
