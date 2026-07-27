# agent-proctor

第三方独立的 Agent **监考 / 评测**引擎（三轴：行为 / 模型 / 工具）。  
引擎不持有正式题库；被测项目以 **`papers-v1` 考卷库**（`exam.json` + `items/` `papersets/` `rooms/` `materials/`）自持资产。

需求依据：`40-评测工具/02-最终PRD.md`（终稿 v2）。设计文档见 [`docs/README.md`](docs/README.md)。

## 要求

- Node.js **≥ 22.22.0**（推荐本机 `/usr/local/bin` 的 **24.18**；见 `.node-version`）
- npm

```bash
export PATH="/usr/local/bin:$PATH"   # 若默认仍是 Homebrew 22.16
node -v   # 期望 ≥22.22，推荐 24.18.0
```

## 快速开始

```bash
npm install
npm run verify
npm run proctor -- item validate --project examples/demo-project
npm run proctor -- run --axis A --paperset smoke-A-L1 --project examples/demo-project
```

在被测仓库生成考卷库骨架：

```bash
npm run proctor -- init /path/to/sut --name my-agent-papers
```

## CLI（节选）

| 命令                                             | 说明                                         |
| ------------------------------------------------ | -------------------------------------------- |
| `proctor item validate`                          | 校验试题 / 考卷库                            |
| `proctor item new / bump-rev / retire / migrate` | 试题演进                                     |
| `proctor init`                                   | 生成 `papers-v1` 骨架                        |
| `proctor run [--concurrency N]`                  | 按轴跑试卷（A L1/L2/L3、B direct/hosted、C） |
| `proctor compare` / `baseline pin`               | 结果对比与基线                               |
| `proctor report show` / `report trend`           | 单次报告 / 多 run 指标时间线                 |
| `proctor contract verify`                        | 宿主契约探针                                 |
| `proctor cassette record`                        | journal → cassette                           |

## 当前进度

- **Phase 1 DoD**：已收口（[design/20](docs/design/20-phase1-dod-closure-2026-07-26.md)）
- **Phase 2 最小面**：L3 cassette、C 轴 echo/write、item 演进、ST-\* L1≥10、OpenCode 录制器（见 [design/26](docs/design/26-live-selftest-and-node-2026-07-27.md)）
- **未宣称**：npm 公开发布（**暂缓**；先 Git 开源，见 [design/28](docs/design/28-ops-path-npm-st-2026-07-27.md)）；ST 完整 Coordinator e2e；完整 Plugin 假宿主（明确不做）

## 许可

MIT
