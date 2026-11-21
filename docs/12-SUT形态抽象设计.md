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

  /** 释放通道（进程型=kill；服务型=停实例；HTTP=无操作）。 */
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
| `HerdchestraAdapter`     | 实现 8 阶段：`prepare` 起实例、`submit` 投指令、`collect` 读工作区终态、`cleanup` 关实例     | 中             |
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

#### 评测目标已定：黑盒行为（2026-11-16）

**结论：AITestTools 的断言层是黑盒行为，不做白盒编排结构断言。**

这个问题的答案不在代码里，在评测目标里。已确认的选择是黑盒，依据：

| 维度     | 黑盒                                           | 白盒                             |
| :------- | :--------------------------------------------- | :------------------------------- |
| 断言什么 | 模型收到什么、界面显示什么、工作区文件改成什么 | 几个子代理、看板怎么流转、委派层 |
| 依据     | mock + UI + 文件                               | 需要内部事件                     |
| 跨形态性 | **契约对所有形态都成立**（宿主/插件/模型）     | 每换一个 SUT 都要重谈            |
| 侵入性   | 零                                             | 需被测方改代码并长期维护契约     |

**黑盒的固有局限（已知并接受）**：测不到 Herdchestra 的编排铁律——委派层级、看板状态机、`take-or-die` 令牌流转、上下文屏障。这些是其 `AGENTS.md` 十条硬约束的主体内容。若将来需要断言这些，属于**评测目标变更**，不是本设计的能力缺口，须重新决策。

**因此 D2 的方案排序按「黑盒」目标收敛**：方案 2（扩展控制通道只读 op）**不在当前范围内**，不再作为备选保留。

#### 方案排序（按黑盒目标收敛）

| 序  | 方案                                                            | 前提           | 评价                                                     |
| :-- | :-------------------------------------------------------------- | :------------- | :------------------------------------------------------- |
| 1   | **黑盒三招**：mock 外部依赖 + 读工作区文件 + 读控制通道/UI 终态 | 无需它改代码   | 与其自身 E2E 同构，已被证明可行。**当前唯一实施路径**    |
| 2   | 备份包导出                                                      | 无需改代码     | 只覆盖用户数据，测不了执行轨迹，仅作补充                 |
| —   | 扩展控制通道只读 op                                             | 需它改约 20 行 | **不在当前范围**：仅白盒需求成立时才考虑，属评测目标变更 |
| —   | 读 Datalevin                                                    | 无需改代码     | **排除**：产品明确拒绝，且其自身 E2E 无先例              |

**取舍原则**：黑盒目标下只做方案 1，方案 2 作补充。方案「扩展 op」与「读 Datalevin」均不作路径——前者需要白盒目标支撑，后者违反产品边界。

### D3：`HostedAdapter` 的硬编码是否参数化

- **不参数化**：接受「插件版专属」，接第二个插件类 SUT 时复制一份
- **参数化**：抽 `PluginHostTransport` + 环境声明，成本约 10 个模块改动

**影响**：若近期只接 Herdchestra（服务类），参数化收益低；若要接多个插件类 SUT，则必要。

### D4：状态重置语义（已实测，2026-11-16）

**这不是设计问题，是性能问题。** 需先厘清两个不同维度：

|          | Herdchestra 的「当前态持久化」               | 测试需要的「干净环境」                 |
| :------- | :------------------------------------------- | :------------------------------------- |
| 解决什么 | 大规模协作下的存储与重放成本（它内部的问题） | 测试之间的状态污染（我们的问题）       |
| 手段     | 折叠历史、只留当前态                         | 独立 `--data-dir` + `--workspace-root` |

两者不在同一层面。**它的历史折叠不但不阻碍测试隔离，反而有利**：数据目录相对小，复制与删除都快，不存在「历史越积越多导致测试变慢」。

它已原生支持隔离（`RUNNING.md`）：`--check` 模式会在隔离数据目录启动完整系统，代码中显式传入 `--data-dir <root>/data` 与 `--workspace-root <root>/work`。

#### 实测结果（2026-11-16）

| 方式                                    | 耗时      | 结论                          |
| :-------------------------------------- | :-------- | :---------------------------- |
| `pixi run clojure …`（冷启动）          | **22 秒** | —                             |
| `pixi run clojure …`（热启动）          | **23 秒** | 与冷启动无差，非 JVM 预热问题 |
| 直接调 `.pixi/envs/default/bin/clojure` | **23 秒** | 绕开 `pixi` 包装无收益        |

系统自身 `:uptime-ms` 仅 118–162ms——**22 秒几乎全花在 Clojure 类加载与依赖初始化，不是应用启动逻辑**。

#### 决策：每 case 一个实例（2026-11-18 修正）

22 秒 × N 个 case 在 100 case 规模下约 37 分钟纯启动开销。曾据此决定「复用实例 + 每 case 新会话」，但该方案**已被证伪**（见下方「决策修正」）——Herdchestra 的 workspace 是进程级，会话级无法隔离。故回到**每 case 一实例**：

- **`prepare` 起实例，`cleanup` 关实例**，case 之间不共享任何状态
- **case 串行执行**（单例锁不允许并发）
- 每 case 用独立 `--data-dir` + `--workspace-root` 临时目录，`cleanup` 时整体删除

**待验证**：`cleanup` 必须等子进程真正退出再删数据目录，否则 Datalevin 的 LMDB 锁文件可能残留导致下个 case 打开失败。实现时需等进程 `exit` 事件而非仅发信号。

**已验证**：`cleanup` 等 `exit` 事件后才删目录（真实复验：`stop()` 耗时 553ms，目录确认删除）。若进程处于不可中断状态，`SIGKILL` 后仍有 5 秒硬上限，超过即放弃等待并记入实例输出，不让 `stop()` 挂死整个 Run。

**风险**：Herdchestra 是「每台机器单一常驻进程」，若 AITestTools 并发跑 case，多实例会撞锁。故**同一时刻只能跑一个实例**，case 之间必须串行。

#### 决策修正：每 case 一个实例（2026-11-18）

上一版写「复用实例 + 每 case 新会话」，**该结论已被源码与其实测 E2E 共同证伪**：

| 事实                                                  | 依据                                                                                    |
| :---------------------------------------------------- | :-------------------------------------------------------------------------------------- |
| `workspace-root` 是**进程级**配置，不是会话级         | `system.clj:2162` `(or (get-in effect [:request :workspace]) (:workspace-root config))` |
| 会话**不携带** workspace 字段                         | 全仓搜索 `workspace-root.*session` / `:session/workspace` 零命中                        |
| Herdchestra 自己的 E2E **每个测试用例起一个全新实例** | `test/e2e/support/app.mjs:280-296`，每次 `startApp` 建全新临时目录                      |

**结论**：同一实例里跑多个 case，被测行为触发的文件写入会全部落在同一个 `workspace-root`，case 间互相污染。「新会话」给不了「新 workspace」。

**故定为每 case 一个新实例**——与其自身 E2E 同构，隔离最彻底。代价是每个 case 24 秒启动开销，已接受（正确性优先于速度）。串行执行，因为单例锁不允许并发。

#### 由此对 `prepare` / `cleanup` 的约束

| 阶段      | 职责                                                                                              |
| :-------- | :------------------------------------------------------------------------------------------------ |
| `prepare` | 建临时目录（data / workspace）→ spawn 实例 → 等 `instance.edn` → `:ping` 确认 → `:create-session` |
| `submit`  | 向该会话投递 `:command`，记录 `session-id` 与投递结果                                             |
| `cleanup` | 终止子进程（等进程真正退出）→ 删临时目录                                                          |

`prepare` 返回的准备态必须包含子进程句柄与临时目录路径，`cleanup` 据此释放。孤儿看门狗要求父进程存活——`prepare` 在 Node 主进程内 spawn 并持有句柄，天然满足。

#### 控制通道实测（2026-11-16，已验证可驱动）

`singleton.clj` 的 loopback 控制通道已实测打通，无需它改任何代码：

| 项           | 实测值                                                                         |
| :----------- | :----------------------------------------------------------------------------- |
| 协议         | TCP + EDN 行协议，请求与回复均为单行 EDN map                                   |
| endpoint     | `<java.io.tmpdir>/herdchestra-<user>/instance.edn`，含 `:port` `:token` `:pid` |
| 鉴权         | 请求必须带 `:token`，不匹配返回 `:SINGLETON_UNAUTHORIZED`                      |
| 就绪耗时     | **24 秒**（从 spawn 到 `instance.edn` 出现）                                   |
| `:ping` 回复 | `{:ok? true, :pid 36082, :url "http://127.0.0.1:62639/", :sessions 1}`         |

**可用 op**（`app.clj` `control-handler`）：`:ping`、`:focus-or-create`、`:create-session`（带 `:title`）、`:command`（`:payload` 为 EDN 命令 map，可带 `:session-id`）。这四者足以支撑 `submit` 与终态查询，**不需要扩展协议**。

**回复契约**（实现与文档必须对齐，否则判活不可靠）：

| 项         | 要求                                                                                                                                                    |
| :--------- | :------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 形状       | 顶层必须是 EDN map，单行，以 `\n` 结尾                                                                                                                  |
| `:ok?`     | **顶层**键，值必须是布尔 `true` / `false`；缺失或非布尔一律判协议不符                                                                                   |
| 失败信息   | `:error` 为嵌套 map，含 `:code`（关键词）与 `:message`（字符串）                                                                                        |
| 解析方式   | **必须完整解析 EDN，禁止用正则扫 `:ok?`**——正则会把 `{:ok? true, :error {...}}`、`{:error {:ok? true}, :ok? false}`、截断行 `{:ok? true` 全部误判为成功 |
| 字符串转义 | 请求侧必须转义 `\` `"` 与全部控制字符（含换行）；裸换行会截断该行并注入下一条请求                                                                       |

#### 三条硬约束（实测发现，必须写进 `LoopbackTransport`）

| 约束               | 现象                                                                | 对实现的要求                                                                                            |
| :----------------- | :------------------------------------------------------------------ | :------------------------------------------------------------------------------------------------------ |
| **孤儿看门狗**     | 父进程是 shell 且已退出时，3 秒宽限期后打印 `HC-ORPHAN-EXIT` 并自杀 | 启动必须由**长驻父进程**持有，不能用 `nohup … &` 后让 shell 退出                                        |
| **单例锁**         | 每机器一把 `instance.lock`，第二实例拿不到锁、只能通过控制通道转发  | **串行**：`prepare` 起实例前先 `:ping` 探测，若已有实例存活则报错（说明上个 case 未清理干净），绝不抢锁 |
| **退出即删 state** | `release!` 会删除 `instance.edn`，进程死后 endpoint 文件消失        | 判活必须「读 state + 试连」，不能只看文件是否存在                                                       |

**跨命令不保活**：实例生命周期绑定启动它的进程。故 `LoopbackTransport.open()` 必须在**同一进程内** spawn 并持有子进程句柄，`close()` 时显式终止——不能依赖外部脚本或 shell 后台任务。

---

## 7. 实施顺序建议

| 序  | 步骤                                                  | 验收                                                                                      |
| :-- | :---------------------------------------------------- | :---------------------------------------------------------------------------------------- |
| 1   | 修 `docs/02` 的 `VibeFsAdapter` 口径                  | 文档与代码一致                                                                            |
| 2   | 定 D1（替换/并存/过渡）                               | 有明确答案                                                                                |
| 3   | ~~实测「起一个 Herdchestra 实例耗时」~~               | ✅ 已测：20–24 秒，定为「每 case 一实例」                                                 |
| 3b  | ~~实测控制通道可否驱动~~                              | ✅ 已测：`:ping` 通，四 op 够用，无需扩展协议                                             |
| 4   | ~~实现 `LoopbackTransport`~~                          | ✅ `src/run/loopback-transport.ts` + 57 测试                                              |
| 5   | ~~实现 `HerdchestraAdapter` 的 `prepare` + `submit`~~ | ✅ `src/run/herdchestra-adapter.ts` + `herdchestra-instance.ts`；真实实例复验 `{ok:true}` |
| 6   | ~~实现黑盒采集：读工作区文件 + 控制通道终态~~         | ✅ 已实现：`collect` 等助手回复 + 工作区文件 diff（见下）                                 |
| 7   | ~~实现 `evaluate` + `cleanup` 的真实判定~~            | ✅ `evaluate` 已按 `workspace_assert` 判定并区分归因（见下）                              |
| 8   | 用 `BDirectAdapter` 验证 `SutTransport` 抽象是否过度  | 若过度，退回「每形态一 adapter」                                                          |

**第 5 步已完成的状态（2026-11-18）**：

| 项                                 | 结果                                                                                                |
| :--------------------------------- | :-------------------------------------------------------------------------------------------------- |
| `preflight` / `prepare` / `submit` | 已实现，每 case 起独立实例                                                                          |
| 真实实例验收                       | 启动 21 秒 → 建会话 → 投命令返回 `{ok:true}` → `stop` 553ms → 目录已删                              |
| `collect`                          | 显式抛 `collect_failed`，**不返回假绿**                                                             |
| `evaluate`                         | 见下文「第 7 步」——已实现真实判定，不再是占位                                                       |
| 已锁死的关键约束                   | endpoint 的 pid 必须等于本次 spawn 的子进程 pid，否则判超时——防止认错实例导致两个 case 结果混在一起 |

**第 8 步是自我证伪**：如果模型类无法用 `SutTransport` 表达，说明这个抽象只适用于「有状态的 SUT」，应明确写进文档而不是强行统一。

**第 6 步已完成的状态（2026-11-20）**：

采集口径按「黑盒只看工作区文件变化」定死，判据全部来自事实，不 mock 模型。

| 项                   | 结果                                                                                                                                                                                                              |
| :------------------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 终止判据             | ①出现**基线之外**的 `role: assistant` 成功消息；②消息签名（`messageId` + **整串内容** + `updated-at` + 错误码）连续静止 `settleMs`（默认 6000 毫秒）                                                              |
| 防假绿一：旧回复     | 投递前先读已存在的助手消息 id 作基线，只认基线外的新消息                                                                                                                                                          |
| 防假绿二：流式截断   | **实测抓到过只返回「我把」两字的半截回复**。稳定窗按**毫秒**而非轮询次数——按次数会随 `pollIntervalMs` 缩水（间隔 200ms 时 3 次只有 0.6 秒）                                                                       |
| 防假绿三：等长改写   | 签名用整串内容而非长度：模型换词/改错字时长度不变，只比长度会把改写当静止                                                                                                                                         |
| 防假绿四：失败消息   | 语义定为「存在任一成功消息 = replied」；只有全是失败消息才算本轮失败（模型可能先报错再重试成功）                                                                                                                  |
| 采集对象             | `<rootDir>/work` 的快照 diff：`added` / `modified` / `removed`，并保留变化文件的内容                                                                                                                              |
| 基线时点             | 建会话之后、投递之前拍基线——实例自身初始化写的文件不算被测产出                                                                                                                                                    |
| 二进制与大文件       | 含 NUL 字节或超过 512 KB 的文件不进快照；递归深度上限 32 层                                                                                                                                                       |
| 超时与取消           | 默认 300 秒；支持 `AbortSignal`；超时如实返回 `replied=false, timedOut=true`，**不造假结果**                                                                                                                      |
| 失败即收尾           | `prepare` 取基线失败时先 `stop()` 再抛错——否则子进程、临时目录与**单例锁**一起泄漏，后续 case 全撞 `INSTANCE_OCCUPIED`                                                                                            |
| 已验证的协议事实     | `:command` 下**所有** kind 都必须是 EDN 关键词；传字符串会被拒为 `COMMAND_KIND_REQUIRED`（已在类型层用 `ControlCommandPayload` 强制）                                                                             |
| 已验证的模型配置事实 | 连接的 `:models` 必须是**对象数组**，每项含 `:id` / `:model-name` / `:capabilities`。漏声明 `:tools` 会被拒为 `MODEL_TOOLS_UNAVAILABLE`；密钥经 `encodeEdnString` 转义（控制字符转 `\u00XX`），只写进实例临时目录 |
| 测试                 | 27 个（快照/diff/基线/稳定窗口/等长改写/错误消息/配置生成与转义/取消/形状），全量 1119 通过                                                                                                                       |
| 可证伪验证           | 去掉基线过滤 → 2 条变红；把签名改成按内容长度 → 等长改写用例精确变红（`'a1:3:1:'` 两侧相同，证明缺陷被抓）；恢复后全绿                                                                                            |

**真实模型实测（2026-11-20，端点 `ctyun.lcw918.loan`，模型 `deepseek-v4-1-flash-1017`）**：

| 轮次               | 结果                                                                                 |
| :----------------- | :----------------------------------------------------------------------------------- |
| 1                  | `submit` 拒收 `MODEL_TOOLS_UNAVAILABLE`——`:capabilities` 未声明 `:tools`             |
| 2                  | `submit` 成功，6 秒返回 `replied=true`，但正文只有「我把」——流式截断，工作区无变化   |
| 3、4               | 助手消息 0 条，38 秒 / 181 秒无进展，工作区无变化                                    |
| 端点直测（纯文本） | 同一请求耗时 36.7 秒 / 16.9 秒，波动 2 倍以上；带 `tools` 时出现过 60 秒超时与空返回 |

**结论**：采集链路在协议层已跑通（能投递、能读 history、能算 diff、能如实报超时），但**「模型真的改了工作区文件」这一真实绿从未达成**。根因在端点侧：该模型端点对带 `tools` 的请求响应慢且不稳定，Herdchestra 的 `call-1` 因此以 `RUN_ERROR :failed` 结束，后续工具调用虽 `succeeded` 但没有落到工作区。

要闭环需要换一个 tools 调用稳定的模型端点；采集侧无需再改。

**模型接入方式**：`HC_EVAL_MODEL_BASE_URL` / `HC_EVAL_MODEL_API_KEY` / `HC_EVAL_MODEL_NAME` 三个环境变量，或 `HerdchestraAdapterOptions.model`。密钥只写入本次实例的临时 `config.edn`，随 `cleanup` 一起删除，不落代码、不落仓库。

**暂不做的事**：白盒观测（扩展控制通道只读 op）不在当前范围——评测目标已定为黑盒行为（见 §6 D2）。

**第 7 步已完成的状态（2026-11-20）**

`evaluate` 只依据采集到的事实判定，`cleanup` 收尾实例（已完成于第 5 步）。

| 情况                                         | 判定         | 归因                                               |
| :------------------------------------------- | :----------- | :------------------------------------------------- |
| `workspace_assert` 全部通过                  | 通过         | —                                                  |
| 有断言失败                                   | 失败         | `TOOL`——模型没把活干对                             |
| 模型未回复（含超时）                         | 失败         | `CONTEXT`——环境/模型没跑起来，**不算模型能力问题** |
| 命令未被接受（如 `MODEL_TOOLS_UNAVAILABLE`） | 失败         | `HARNESS`——试题或模型配置错了                      |
| 断言本身配错、或用了该形态不支持的断言类型   | 失败         | `HARNESS`——配错不能假装通过                        |
| 无任何 `workspace_assert`                    | 只看是否回复 | 回复即通过                                         |

关键取舍：

- **不为「配错的题」造假绿**：service 形态没有进程退出码、stdout、事件流。遇到 `exit_code` 等其它断言类型时**如实报不支持**并归 `HARNESS`，而不是静默跳过——静默跳过会让整题凭空通过。
- **命令被拒不再抛错**：原先 `collect` 抛 `collect_failed`，整个 case 直接 `execution_failed`，配错与模型失败混在一起无从分辨。现改为 `collect` 返回 `commandAccepted: false` 的占位采集结果，交由 `evaluate` 归 `HARNESS`。
- **失败项顺序**：`oracle_failures` 首条固定为 `harness`（承载整体原因），其后才是各 oracle 的具体失败，便于下游区分「整体原因」与「逐条证据」。
- **堵住三条静默假绿路径**（独立审查后补）：
  - _基线不可靠_：投递前读会话失败会让基线为空集，上一轮的旧回复就会被当成本轮回复。现把 `baselineReliable` 一路传到 `evaluate`，不可靠时不宣称 replied，归 `HARNESS`。
  - _通道故障冒充模型没产出_：整个等待期一次都没读到会话，多半是控制通道失效。`waitForAssistantReply` 返回 `readFailed`，此类归 `HARNESS` 而非 `CONTEXT`。
  - _环境故障污染缺陷数_：`workspace_assert` 读文件失败（指向目录、权限不足）原记 `TOOL`，会把环境问题算成模型缺陷。现归 `HARNESS`。

| 项         | 结果                                                                                                              |
| :--------- | :---------------------------------------------------------------------------------------------------------------- |
| 新增测试   | `workspace_assert` 12 个、`evaluate` 16 个、工作区端到端 3 个                                                     |
| 全量       | 121 个文件 / 1144 个用例通过，`tsc --noEmit` 与 `eslint` 无告警                                                   |
| 可证伪验证 | 破坏 `not_contains` / `exists:false` / `readFailed` 区分 / 基线保护 / 读文件归因，每次均精确 1 条变红，恢复后全绿 |

---

## 8. 风险

| 风险                       | 说明                                                                               | 缓解                                                                                                                                                                                                                                                                                                                                                                           |
| :------------------------- | :--------------------------------------------------------------------------------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 黑盒覆盖不足               | 编排铁律（委派层级/看板/令牌）无法断言，这是黑盒的固有局限                         | **已知并接受**（§6 D2）。若将来必须断言，属评测目标变更，需重新决策                                                                                                                                                                                                                                                                                                            |
| 状态无法重置               | 若实例启动过慢，逐 case 起实例不现实                                               | ✅ 已实测 20–24 秒（§6 D4）。已定为「每 case 一实例」——复用实例因 workspace 是进程级而无法隔离                                                                                                                                                                                                                                                                                 |
| 抽象过度                   | `SutTransport` 可能只适用于有状态 SUT                                              | 用 `BDirectAdapter` 做证伪（§7 第 8 步）                                                                                                                                                                                                                                                                                                                                       |
| 插件版退化                 | 抽取 `PluginHostTransport` 时改坏 `HostedAdapter`                                  | 现有 1014 个测试是回归网；每步改动后全量跑                                                                                                                                                                                                                                                                                                                                     |
| 单例冲突                   | Herdchestra 是「每台机器单一常驻进程」，并发跑 case 会撞锁                         | ✅ 已实测锁机制（§6 D4）。`prepare` 先 `:ping` 探测，已存在则复用不重启                                                                                                                                                                                                                                                                                                        |
| 孤儿自杀                   | 父进程退出会触发看门狗，实例自行终止                                               | ✅ 已实测（§6 D4）。`open()` 须同进程持有子进程句柄，不依赖 shell 后台                                                                                                                                                                                                                                                                                                         |
| `not_implemented` 落盘口径 | 编排层记 `not_evaluated`，落盘若按 `pass=false` 计入分母，会把能力缺失写成被测失败 | ✅ 已统一并跨模块收口。`run.json` 题级写 `not_evaluated: true` 且省略 `pass`（含「完全无结果行」的题）；`results.ndjson` 保留 `pass` 布尔并加 `not_implemented: true` 自证；`src/report/artifacts.ts` 提供 `isEvaluated` / `evaluatedOnly` / `passRateOf` 统一入口，对照、看板、归因、配对键一律走它。无样本时通过率为 `n/a`、门禁不宣判、CLI 退出码 3、作业态 `not_evaluated` |
| cleanup 异常被吞           | 编排层原对 `cleanup` 异常空 `catch`，实例/临时目录/单例锁泄漏无人知晓              | ✅ 已改为追加 `harness:cleanup` 到 `oracle_failures` 随结果落盘，题级 OR 汇合为 `cleanup_failed`，`report.md` 单列「资源泄漏（编排侧）」；主判定与归因不受影响                                                                                                                                                                                                                 |

---

## 8.1 端到端冒烟测试（2026-11-20）

真实模型端点不稳定时，链路本身仍需被验证。用**假 SUT**（真子进程 + 真 TCP + 真写盘）跑完整五步，不依赖任何模型。

| 项         | 做法                                                                                                                                                                        |
| :--------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 接入方式   | `options.command` 换成 `node`，`commandArgs` 指向 `tests/run/fixtures/fake-herdchestra.mjs`                                                                                 |
| 隔离方式   | `endpointDir` 注入独立根目录；实际路径由 `resolveEndpointDir` 在其下拼 `herdchestra-<user>`，与真实实例完全隔离                                                             |
| 协议对齐   | 回复顶层字段必须是 `:ok?`（带问号）；命令走 `{:op :command, :payload {:kind :send-message …}}` 的**嵌套**形状；读历史同为 `:command` + `kind=history/messages`，不是独立 op |
| 覆盖场景   | 正常判绿、内容不符判 `TOOL`、未写文件判失败、只收不回判 `CONTEXT`、实例不就绪报 `HARNESS`、cleanup 无残留、已有文件改判 `modified`                                          |
| 测试       | `tests/run/herdchestra-e2e.test.ts` 7 个用例，全部真起子进程                                                                                                                |
| 可证伪验证 | 去掉「等回复」→ 1 条变红；不传 `--endpoint-dir` → 6 条变红；断言指向不存在文件 → 1 条变红；恢复后全绿                                                                       |

**结论**：此前从未被真实跑通的「改文件 → diff 捕获 → 断言判绿」路径，现已由假 SUT 完整验证。真实模型接入只需换端点，链路不再有待验证环节。

---

## 9. 与既有文档的关系

| 文档            | 关系                                                                |
| :-------------- | :------------------------------------------------------------------ |
| 02 §1 原则 1    | 本文是其落地设计；同时修正其中 `VibeFsAdapter` 的失实描述           |
| 07 §3.1         | 本文验证 8 阶段契约足以容纳服务型 SUT，不改契约                     |
| 05 领域对象映射 | 新增 `SutTransport` / `SutObservation` 需登记到 05                  |
| 04 实验方案     | 服务类 SUT 的 ON/OFF 对照语义待定（Herdchestra 无「插件开关」概念） |
