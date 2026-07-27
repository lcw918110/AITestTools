# 自主推进过程记录（2026-07-26 → 07-27）

| 字段 | 值                                                                  |
| :--- | :------------------------------------------------------------------ |
| 顺序 | hosted → Phase2 → ST-\* L1 → OpenCode cassette → Node 24.18 → gates |
| 原则 | 无阻断不中停；不粉饰未完成项                                        |

---

## 已完成摘要

| 项                                       | 结果                                                            |
| ---------------------------------------- | --------------------------------------------------------------- |
| ST-\* L1 ≥10                             | **12/12**（24）                                                 |
| OpenCode 录制插件 + journal 回放         | **最小面绿**（25）；live 自测绿（26）                           |
| hosted 自动录制挂钩                      | `PROCTOR_RECORD_CASSETTE=<id>`                                  |
| Node 24.18                               | `.node-version`；会话 PATH；verify + 冒烟绿；标准 promptfoo CLI |
| paperset gates / concurrency / trend     | **已落地**（27）                                                |
| hosted NDJSON 竞态短等                   | **已修**；hosted-smoke PASS                                     |
| C：workspace_assert / tool_result_equals | **已接入**                                                      |
| 完整 Plugin 假宿主                       | **明确不做**                                                    |
| 密钥轮换 / npm 发布                      | **仍需你**                                                      |

---

## 当前停点（仅需你）

| 卡点            | 需要你                                    |
| --------------- | ----------------------------------------- |
| 密钥轮换        | 美团 / DeepSeek 控制台                    |
| npm 公开发布    | registry 账号与包名确认                   |
| 默认 shell PATH | 若仍指向 22.16，自行优先 `/usr/local/bin` |
| ST 真 git e2e   | ST-06/09/12/14/16 真宿主环境              |

## 命令

```bash
export PATH="/usr/local/bin:$PATH"
npm run verify
npm run proctor -- run --axis A --paperset smoke-A-L3 --project examples/demo-project

PROCTOR_RECORD_CASSETTE=live-v1 SUT_ROOT=../wanxiangshu \
  npm run proctor -- run --axis B --paperset hosted-smoke \
  --project ../wanxiangshu/papers
```
