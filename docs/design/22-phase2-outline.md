# Phase 2 提纲（2026-07-26，状态 2026-07-27 更新）

| 字段 | 值                                                |
| :--- | :------------------------------------------------ |
| 状态 | **最小可运行面已绿；不宣称 Phase 2 整体完成**     |
| 依据 | PRD §7 Phase 2；用户「继续直到无介入无法下一步」  |
| 前置 | Phase 1 DoD 收口；万象术 L1/L2/hosted-ndjson 已通 |

---

## 范围（PRD）对照

| PRD 项                                   | 本仓状态                                                               |
| ---------------------------------------- | ---------------------------------------------------------------------- |
| L3：cassette 3~5 盘 + fakehost 对拍      | **smoke-A-L3 6/6**（含 journal + live journal）；真录制见 design/25–26 |
| C 轴：CLI 壳 + 2 个本地工具 suite        | **smoke-C-echo / smoke-C-write 全绿**                                  |
| `item new / bump-rev / retire / migrate` | **已实现**                                                             |
| ST-\* 导入 ≥10（优先 L1）                | **12/12 PASS**（design/24）；真 git e2e 未做                           |
| 录制器插件                               | **最小面绿**（design/25）；live hosted 录制自测绿（design/26）         |

---

## 已落地路径

| 模块          | 路径 / 命令                                                  |
| ------------- | ------------------------------------------------------------ |
| cassette 装载 | `src/drivers/cassette/`                                      |
| L3 runner     | `src/run/l3-runner.ts`（FakeHost 回放对拍）                  |
| C runner      | `src/run/c-runner.ts`                                        |
| 演进 CLI      | `proctor item new \| bump-rev \| retire \| migrate`          |
| demo cassette | `cassettes/{boundary,nudge,text-stop,review-tools}-smoke-v1` |
| 录制          | `recorder-plugin.mjs` + `PROCTOR_RECORD_CASSETTE`            |

---

## 复查

```bash
export PATH="/usr/local/bin:$PATH"   # Node 24.18
npm run verify
npm run proctor -- run --axis A --paperset smoke-A-L3 --project examples/demo-project
npm run proctor -- run --axis C --paperset smoke-C-echo --project examples/demo-project
npm run proctor -- run --axis C --paperset smoke-C-write --project examples/demo-project
```

## 明确不宣称

- Phase 2 整体完成（ST 真 git / 全量万象阵仍缺）
- npm 公开发布
- 完整 Plugin 假宿主（拍板不做）
