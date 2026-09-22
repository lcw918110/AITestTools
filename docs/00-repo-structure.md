# 00 · 本仓库目录结构

| 字段   | 值                                    |
| :----- | :------------------------------------ |
| 状态   | **现行**                              |
| 日期   | 2026-09-08                            |
| 阅读序 | 总索引第 **0** 篇（先认路，再读 PRD） |

业务阅读序见 [README.md](README.md)：需求 → 架构 → 设计 → 过程 → 测试。下文用一棵树说明各路径做什么；`#` 后为注释。

> 已删除 `40-评测工具/`：PRD 迁至 `docs/requirements/01-prd.md`，Phase 0 样例迁至 `tests/fixtures/legacy-phase0/`。

```text
AITestTools/                              # agent-proctor 引擎仓（npm 包名 agent-proctor，CLI 名 proctor）
│
├── AGENTS.md                             # Agent：grill-me + 完成前自测
├── .cursor/skills/                       # grill-me / 设计 / 编码规范 / 自测 / 代码审查
├── README.md                             # 开源首页：安装、快速命令、文档入口
├── LICENSE                               # 许可
├── CHANGELOG.md                          # 包级变更记录
├── package.json                          # npm 包定义；bin=proctor；脚本别名见 scripts/
├── package-lock.json
├── .node-version                         # 推荐 Node 版本（如 24.18）
├── .env.example                          # 密钥环境变量样例（勿提交 .env）
├── .gitignore                            # 忽略 dist/、runs/、node_modules/、.env 等
├── .editorconfig / .prettierrc.json / .prettierignore
├── eslint.config.js
├── tsconfig.json / tsconfig.build.json
├── vitest.config.ts
│
├── schemas/                              # papers-v1 JSON Schema（随包发布）
│   ├── exam.schema.json                  # 考卷根 exam.json
│   ├── item.schema.json                  # 单题 item
│   ├── paperset.schema.json              # 题组 paperset
│   └── room.schema.json                  # 考场 room（含 host.plugin 约定）
│
├── src/                                  # 引擎源码（tsc → dist/）
│   ├── index.ts                          # 包导出入口
│   ├── cli/
│   │   ├── main.ts                       # proctor 入口、HELP、子命令分发
│   │   └── commands/                     # 子命令实现
│   │       ├── init.ts                   # proctor init
│   │       ├── run.ts                    # proctor run
│   │       ├── item-*.ts                 # validate / new / bump-rev / retire / migrate / resolve
│   │       ├── compare.ts                # 两次 run 对比 + effect_compare.md
│   │       ├── score-write.ts            # 参考分写入 scores.json
│   │       ├── baseline-pin.ts           # 钉选基线
│   │       ├── report-show.ts / report-trend.ts
│   │       ├── contract-verify.ts
│   │       └── cassette-record.ts
│   ├── exam-engine/                      # 考卷装载、schema 校验、digest、路径解析
│   ├── drivers/                          # 执行驱动
│   │   ├── fold/                         # Fold 直驱（A 轴事件）
│   │   ├── fakehost/                     # 契约假宿主
│   │   ├── model-adapter/                # B 轴直连模型（Promptfoo 等）
│   │   ├── cassette/                     # L3 磁带回放
│   │   └── scripted/                     # 脚本化模型桩
│   ├── run/                              # 各轴 runner、gates、写 run 产物
│   ├── oracles/                          # 白名单判定器（fold、workspace、tool_trace…）
│   ├── attribution/                      # 失败归因（含 hosted 判定树）
│   ├── contract/                         # 宿主契约与 verify
│   ├── metrics/                          # 指标目录与聚合
│   └── report/                           # compare、效果分列、趋势
│
├── apps/
│   └── console/                          # 本地评测操作台（npm run console → :8787）
│       ├── server.ts                     # HTTP 入口：静态页 + API 路由
│       ├── bank.ts                       # 题库列表/编辑/新建/校验
│       ├── eval-tasks.ts                 # 可保存测试任务（选题+配置+跑次）
│       ├── test-sets.ts                  # 测试集读写（组卷/筛选）
│       ├── run-plan.ts                   # 组跑计划：任务→考场/题组展开
│       ├── run-summary.ts                # 跑次摘要与结果聚合
│       ├── dashboard.ts                  # 测试结果看板（矩阵 / Δ / CONTEXT）
│       ├── env-catalog.ts                # 运行环境：模型/Agent 清单与 Hello World
│       ├── public/                       # 静态 UI
│       │   ├── index.html                # 顶栏：测试 | 题库 | 运行环境
│       │   ├── app.js                    # 测试任务 / 测试结果页
│       │   ├── bank.js                   # 题库工作台页
│       │   ├── env.js                    # 运行环境页
│       │   └── styles.css
│       └── .jobs/                        # 任务日志缓存（gitignore）
│
├── dist/                                 # 构建产物（gitignore，不入库）
├── node_modules/                         # 依赖（不入库）
├── runs/                                 # 默认本地跑卷输出（gitignore）
│
├── examples/                             # 可运行考卷样例与题库副本
│   │
│   ├── demo-project/                     # 引擎自测 / CI：A/B/C smoke、假宿主、磁带等
│   │   ├── exam.json
│   │   ├── rooms/                        # fold-v1、fake-host、hosted-opencode、model-direct、shell-echo…
│   │   ├── items/                        # A / B / C 轴样例题
│   │   ├── papersets/                     # smoke 与 eval-model、eval-agent 等题组
│   │   ├── materials/                    # 每题 stimulus / expected 等物料目录
│   │   ├── contracts/                    # demo-host-v1.json
│   │   ├── cassettes/                    # 预录磁带
│   │   ├── shells/                       # C 轴 shell 驱动样例
│   │   ├── scripts/                      # 脚本化模型 JSON
│   │   ├── sut/                          # 演示用 fold / plugin 桩（非被测仓本体）
│   │   ├── baselines/ / runs/            # 本地基线与跑卷残留
│   │   └── README.md
│   │
│   ├── product-eval/                     # 产品效果：1 题库 + 考场/组卷/协议
│   │   ├── exam.json                     # paths → bank / rooms / papersets / protocol
│   │   ├── bank/
│   │   │   ├── materials/                # 输入（PAIRED-TASK-01..05）
│   │   │   └── items/                    # 判定 + 业务属性（OFF/ON）
│   │   ├── rooms/                        # plain / plugin / model-alt
│   │   ├── papersets/                    # eval-model · paired-off/on · eval-agent
│   │   ├── eval-tasks/                   # 操作台测试任务（*.json gitignore）
│   │   ├── protocol/rubrics/             # 参考分量表
│   │   └── README.md
│   │
│   └── wanxiangshu-papers/               # 万象术题库本地副本（权威源在被测仓 papers/）
│       ├── exam.json、rooms/、items/、papersets/、materials/、contracts/、scripts/
│       ├── adapters/                     # 如 fold-bridge.mjs
│       └── …                             # npm run sync:papers 从 SUT_ROOT/papers 刷新
│
├── templates/
│   └── project/                          # proctor init 生成的空考卷骨架
│       ├── exam.json、rooms/、items/、papersets/、materials/
│       └── README.md
│
├── scripts/
│   ├── sync-sut-papers.sh                # SUT_ROOT/papers → examples/wanxiangshu-papers
│   └── eval-paired.sh                    # 校验 product-eval；PROCTOR_EVAL_LIVE=1 跑配对
│
├── tests/                                # Vitest 单测与兼容夹具
│   ├── cli/                              # compare、main、report-trend…
│   ├── drivers/                          # fold、cassette、fakehost…
│   ├── exam-engine/                      # validate、digest
│   ├── oracles/                          # 各判定器
│   ├── run/                              # gates
│   ├── attribution/                      # hosted 判定树
│   ├── contract/
│   ├── compat/
│   │   └── legacy-assets.test.ts         # 与 Phase 0 样例协议对齐
│   ├── fixtures/
│   │   ├── broken-project/               # 故意损坏的校验用例
│   │   └── legacy-phase0/                # 原 40-评测工具 harness 样例（兼容测试）
│   └── helpers/
│
├── docs/                                 # 文档（按阅读序编号）
│   ├── README.md                         # 总索引
│   ├── 00-repo-structure.md              # 本文：仓库地图
│   │
│   ├── requirements/                     # ① 需求
│   │   ├── README.md
│   │   ├── 00-glossary.md                # 术语与概念（唯一实体）
│   │   ├── 01-prd.md                     # 产品需求终稿
│   │   ├── 02-console-prd.md              # 产品控制台 PRD
│   │   └── 03-bank-editor-prd.md          # 题库录入 / 编辑 PRD
│   │
│   ├── architecture/                     # ② 架构
│   │   ├── README.md
│   │   └── adr/
│   │       ├── 0001-tech-stack.md
│   │       ├── 0002-repo-layout-and-assets.md
│   │       ├── 0004-b-direct-adapter-strategy.md
│   │       ├── 0005-naming-host-fold.md
│   │       ├── 0006-final-review-decisions.md
│   │       ├── 0007-promptfoo-spike-fixture.md
│   │       └── 0008-local-sut-papers-copy.md
│   │
│   ├── design/                           # ③ 设计
│   │   ├── README.md
│   │   ├── 01-phase-outline.md           # Phase 1/2 提纲合并
│   │   ├── 02-protocol-papers-v1.md
│   │   ├── 03-fold-entry-contract.md
│   │   ├── 04-state-predicate.md
│   │   ├── 05-scripted-model.md
│   │   ├── 06-host-contract-schema.md
│   │   ├── 07-hosted-attribution-tree.md
│   │   ├── 08-console-outline.md          # 产品控制台设计提纲
│   │   └── 09-bank-editor.md              # 题库工作台设计
│   │
│   ├── process/                          # ④ 过程 / 验收
│   │   ├── README.md
│   │   ├── 01-changelog.md               # 唯一过程日志（当前态）
│   │   ├── 02-unfreeze-checklist.md
│   │   ├── 03-phase1-dod.md
│   │   └── 04-final-review.md
│   │
│   ├── test/                             # ⑤ 测试操作
│   │   ├── README.md
│   │   ├── 01-wanxiangshu-ops.md         # 测万象术 / 模型·Agent·插件 操作手册
│   │   ├── 02-engine-regression.md       # 引擎 A/B/C 工程回归
│   │   └── 03-console-ops.md              # 评测操作台测试手册
│   │
│   └── archive/                          # 追溯归档（非日常阅读）
│       ├── README.md
│       ├── design/                       # 过时 RFP、一次审核等
│       └── process/                      # 按日期的过程记录
│
└── .github/workflows/ci.yml              # push/PR：verify + smoke:offline
```

**运行约定**

- `--project` 指向 `examples/` 下某一考卷根（`demo-project`、`product-eval`、`wanxiangshu-papers`）。
- 被测仓构建产物（Fold、Plugin 等）通过环境变量 **`SUT_ROOT`** 指向，不复制进本仓源码树。
- 常用 npm 脚本：`eval:paired`、`eval:model`、`smoke:wanxiangshu`（仅 C git）、`smoke:offline`、`verify`。`sync:papers` / L1 ST / coordinator **已知失效**（万象术 0.8+）。

**相关入口**

- 文档总索引：[docs/README.md](README.md)
- 测万象术：[test/01-wanxiangshu-ops.md](test/01-wanxiangshu-ops.md)
- 开源首页：仓库根 [README.md](../README.md)
