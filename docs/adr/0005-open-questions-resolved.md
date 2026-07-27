# ADR-0005：开放问题决议（包名方向 / 考卷资产 / 宿主钉死 / Fold 多入口）

| 字段   | 值                                   |
| :----- | :----------------------------------- |
| 状态   | **部分已采纳**（包名待从候选中选定） |
| 日期   | 2026-07-25                           |
| 决策人 | 产品方拍板                           |

## 背景

Phase 1 提纲 §8 四个开放问题已获答复；本 ADR 固化语义，并给出包名候选供最终选定。

## 决策

### 1. 包名：体现「第三方独立测评」，废弃字面 `agent-harness` / 暂缓 `triaxis-harness`

工作含义：**独立于被测 Agent 与宿主实现的外部考官/测评引擎**，而非被测仓库内嵌测试工具。

候选（实现解冻前必须锁一个；CLI bin 可与包名不同）：

| 候选包名                    | 意味                                   | 备注                   |
| --------------------------- | -------------------------------------- | ---------------------- |
| **`agent-proctor`**（推荐） | 监考官：第三方、不参与答题，只出题判卷 | 英文短、npm 语义清晰   |
| `indep-exam`                | 独立考试                               | 直白；稍泛             |
| `triaxis-proctor`           | 三轴 + 监考                            | 保留三轴品牌，略长     |
| `examkit`                   | 考试工具箱                             | 短；「独立第三方」稍弱 |

CLI 建议统一为：`proctor` 或 `exam`（选定包名后钉死）。  
脚手架当前名 `triaxis-harness` 仅作草稿，解冻时改名。

### 2. 被测仓库「资产」= 题库/考卷类测试数据（非产品源码）

隐喻约定（对内对外文案可用中文，**目录用英文**）：

| 隐喻       | 目录/文件                             | 说明                                                                                    |
| ---------- | ------------------------------------- | --------------------------------------------------------------------------------------- |
| 考场项目根 | **`exam/`**（推荐）                   | 被测仓库内资产根，替代原建议 `harness/`                                                 |
| 报名表     | `exam/exam.json`（原 `harness.json`） | 指明 suites/profiles 等相对路径与引擎协议版本                                           |
| 试题       | `exam/questions/`（原 `cases/`）      | 单题 = 原 case；文件可仍 `*.case.json` 或后续改为 `*.question.json`（实现期再钉扩展名） |
| 试卷       | `exam/papers/`（原 `suites/`）        | 一组试题 + 门禁 + profile                                                               |
| 考场配置   | `exam/profiles/`                      | 不变语义                                                                                |
| 答题材料   | `exam/fixtures/`                      | 刺激物、期望折叠态等                                                                    |
| 剧本       | `exam/scripts/`                       | L2 scripted 模型                                                                        |

本仓库样例目录可同步改为 `examples/demo-exam/`（实现解冻时改；设计阶段只定名）。

> 说明：资产仍**物理放在被测仓库**（与产品同仓便于演进），但由**本引擎以第三方身份读取并判卷**——「同仓存放」≠「同属被测方测试代码」。

### 3. 真宿主版本：以本机 OpenCode 为准

- 探测结果：本机 `/opt/homebrew/bin/opencode` → **`1.17.14`**
- Phase 1 `contract verify` 默认钉死：`opencode@1.17.14`
- 契约文件工作名：`contract/opencode-v1.17.json`（次版本线；补丁号记入 verify 留档元数据）

若本机日后升级，须升契约或重跑 verify；不以远程「最新」为准。

### 4. Fold 入口：profile 可配置多项 entry；`wanxiangshu` 仅为被测对象之一

- `fold_entry` **不**写死某一仓库路径。
- profile（或 `exam.json`）声明 **named entries** 映射，例如：

```json
"fold_entries": {
  "wanxiangshu.projection": "build/src/Runtime/Projection.js",
  "other-agent.todo": "dist/fold/todo.js"
}
```

- 试题（case）的 `freeze.fold_entry` 填 **逻辑名**（如上键），由引擎按 `--project` 根目录解析为文件路径。
- 事件 schema 版本亦在 profile / entry 元数据中声明，随被测对象变化，不绑死单一产品。

## 后果

- 正面：第三方身份清晰；考卷隐喻降低理解成本；多被测对象可扩展；宿主版本可复现。
- 负面：与 Phase 0 / 脚手架现用 `cases`/`suites`/`harness.json` 命名不一致——解冻时需迁移映射层或一次性改名；文档与 PRD 字面「harness」并存时需对照表。
- 待决：§1 四个包名候选须再选一个。

## 相关

- `docs/design/01-phase1-outline.md` §8
- ADR-0002（资产归属，本 ADR 补充命名隐喻）
- PRD §3、§4.1、附录 D
