# ADR-0005：命名隐喻、宿主钉死与 Fold 多入口

| 字段   | 值                                                     |
| :----- | :----------------------------------------------------- |
| 状态   | **已采纳**                                             |
| 日期   | 2026-07-25                                             |
| 决策人 | 用户拍板（提纲开放问题 1–4；包名终选 `agent-proctor`） |

## 背景

提纲 §8 四个开放问题需在细化设计前钉死，以免 schema / CLI / 契约文档用词漂移。

## 决策

### 1. 引擎定位与包名（第三方独立测试）

引擎是**独立于被测产品的第三方评测/监考工具**，不是被测仓库的附属脚本。

- **包名（npm）：`agent-proctor`**
- **CLI bin（建议）：`proctor`**（实现解冻时与 `package.json` 一并改；旧名 `harness` / `triaxis-harness` 废弃）
- 文档可称「引擎 / proctor / 监考」

曾列候选（未采用）：`triaxis-proctor`、`exam-proctor`、`aitest-proctor`；废弃：`agent-harness`、`triaxis-harness`。

### 2. 被测侧资产 =「题库 / 考卷」，目录按考卷隐喻命名

是的：被测仓库里的资产就是**可版本化的题库与考卷配置**（试题、试卷集、考场 profile、考材 fixtures），不是引擎源码。

约定目录名（被测仓库内）：

```text
papers/                    # 资产根（考卷库）
  exam.json                # 项目清单（原 harness.json 角色）
  items/                   # 试题（原 cases/；文件仍可用 *.case.json 或 *.item.json，细化设计钉扩展名）
  papersets/               # 试卷（原 suites/）
  rooms/                   # 考场配置（原 profiles/）
  materials/               # 考材：stimulus、期望折叠态、剧本等（原 fixtures/）
  scripts/                 # 可选：剧本模型等
```

人读对照：

| 工程名       | 白话                                          |
| ------------ | --------------------------------------------- |
| `papers/`    | 考卷库根                                      |
| `items/`     | 单道试题                                      |
| `papersets/` | 一套试卷（抽哪些题 + 门禁）                   |
| `rooms/`     | 考场（假宿主 / 真模型 / fold 入口等冻结环境） |
| `materials/` | 发卷附件                                      |

本仓库 `examples/` 与 `templates/` 同步采用该隐喻；CLI 对外可用中英双语帮助文案（「校验试题」「跑试卷」）。

**协议字段亦考卷化**（终审 ADR-0006 C3，否决「字段暂留 case/suite」）：详见 `docs/design/02-protocol-papers-v1.md`。文件用 `*.item.json`；试卷用 `items: []` / `room`；run 产物用 `item_id` / `item_rev`。归因标签 `HARNESS` 保留。

### 3. 真宿主版本：以本机 OpenCode 为准

`contract verify` 与 L2/L3 契约首版钉死：

- 宿主：**OpenCode**
- 版本：**1.18.5**（2026-07-25 本机 `opencode --version`）
- 契约 id 建议形态：`opencode-v1.18`（patch 是否并入契约 id 在 `10-host-contract-schema` 细化）

本机路径备忘：`/opt/homebrew/bin/opencode`；配置目录 `~/.config/opencode`。

### 4. Fold 入口：profile 可配置多项；wanxiangshu 只是其中一个被测

- **不**把某一仓库的 `build/src/.../Projection.js` 写死进引擎。
- 在 **room/profile**（考场配置）中声明 `fold_entries`（多项）：逻辑名 → 模块路径 + 事件 schema 版本。
- 试题（L1）的 `freeze.fold_entry` 引用逻辑名，而非裸路径。
- `wanxiangshu` 作为首个被测适配样例，在其 `papers/rooms/` 里提供一份 entry 表；其它 Agent 产品可另写 room，互不耦合。

## 后果

- 正面：第三方定位清晰；被测侧目录白话；多产品可接入；契约版本可追溯到本机钉死点。
- 负面：与 Phase 0 / 抢跑脚手架的 `cases/` `harness.json` 命名不一致，解冻时需迁移映射与兼容读（或一次性改 examples）。
- 实现解冻前代码仍可能显示旧包名；以本 ADR 为准，解冻检查单含改名项。

## 相关

- 提纲 [`docs/design/01-phase-outline.md`](../../design/01-phase-outline.md) §A.6
- ADR-0002（资产归属；目录名以本 ADR 为准修订）
- 后续：`03-fold-entry-contract.md`、`06-host-contract-schema.md`
