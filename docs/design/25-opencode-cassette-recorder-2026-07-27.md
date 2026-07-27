# OpenCode cassette 录制面（2026-07-27）

| 字段 | 值                                                                    |
| :--- | :-------------------------------------------------------------------- |
| 状态 | **最小面已绿**；live hosted 录制自测见 design/26                      |
| 落盘 | 考卷库 `cassettes/<id>/{journal.ndjson,manifest.json}`                |
| 字段 | 对齐 L3：`replay_mode=journal` + `expected_hooks` / `expected_events` |

---

## 组件

| 件                | 路径                                              |
| ----------------- | ------------------------------------------------- |
| OpenCode 录制插件 | `src/drivers/cassette/recorder-plugin.mjs`        |
| journal 装载/封装 | `src/drivers/cassette/journal.ts`                 |
| L3 journal 回放   | `src/run/l3-runner.ts`（`replay_mode=journal`）   |
| CLI               | `proctor cassette record --from …/journal.ndjson` |
| hosted 挂钩       | `PROCTOR_RECORD_CASSETTE=<id>` → 自动挂插件并封装 |

## 验收（本仓）

- `smoke-A-L3` **6/6**（含 `DEMO-A-L3-JOURNAL-01` / `DEMO-A-L3-LIVE-01`）
- 单测：`tests/drivers/cassette-journal.test.ts`
- live hosted 录制 + journal L3：**PASS**（design/26）

## 真宿主录制

```bash
PROCTOR_RECORD_CASSETTE=live-hosted-record-v1 \
SUT_ROOT=/path/to/wanxiangshu \
  npm run proctor -- run --axis B --paperset hosted-smoke \
  --project /path/to/wanxiangshu/papers
```

## 明确不宣称

- npm 已发布
- 「完整 Plugin 假宿主」（拍板不做）
