# agent-proctor

第三方独立的 Agent **监考 / 评测**引擎（三轴：行为 / 模型 / 工具）。  
正式题库归属被测项目；本仓保留 **本地题库副本**（如 `examples/wanxiangshu-papers/`）供运行与 CI。

- 开源：https://github.com/lcw918110/AITestTools
- 需求：`40-评测工具/02-最终PRD.md`
- 文档：[docs/README.md](docs/README.md)（需求 / 架构 / 设计 / 过程）

## 要求

- Node.js **≥ 22.22.0**（推荐 **24.18**；见 `.node-version`）
- npm

```bash
export PATH="/usr/local/bin:$PATH"
node -v
```

## 快速开始

```bash
npm install
npm run verify
npm run proctor -- run --axis A --paperset smoke-A-L1 --project examples/demo-project
```

万象术题库（本地副本；Fold 需 `SUT_ROOT`）：

```bash
export SUT_ROOT="$(cd ../wanxiangshu && pwd)"
npm run sync:papers          # 从被测仓刷新副本
npm run smoke:wanxiangshu    # st-import-L1 + st-real-git
```

## CLI（节选）

| 命令                                   | 说明               |
| -------------------------------------- | ------------------ |
| `proctor item validate`                | 校验试题 / 考卷库  |
| `proctor run [--concurrency N]`        | 按轴跑试卷         |
| `proctor compare` / `baseline pin`     | 对比与基线         |
| `proctor report show` / `report trend` | 报告 / 趋势        |
| `proctor contract verify`              | 宿主契约           |
| `proctor cassette record`              | journal → cassette |

## 当前进度

- Phase 1 DoD：[process/20](docs/process/20-phase1-dod-closure-2026-07-26.md)
- Phase 2 最小面 / 开源节奏：[process/28](docs/process/28-ops-path-npm-st-2026-07-27.md)
- 题库副本策略：[ADR-0008](docs/architecture/adr/0008-local-sut-papers-copy.md)
- **暂缓**：npm 官方发布；完整 Plugin 假宿主不做

## 许可

MIT
