# 事故现场诊断报告: incident-20260922-091515-Error

- **发生时间**: 2026/9/22 09:15:15
- **事故分类标签**: `Error`
- **运行环境**: OpenCode `1.18.31` | Node.js `v24.18.0`
- **代码基线**: 分支 `main` | 最新提交 `8c4ad19 - hosted 归因改读 EventStore（refs/wanxiang/store），旧 ndjson 不再当挂载证据；真 Plugin 仍缺模块故不装绿。 (2026-08-13 22:45:15 +0800)`
- **事故专项目录**: `/Users/Licw/Desktop/git/AITestTools/.diagnostics/incident-20260922-091515-Error`

---

## 1. 现场致命错误线索 (Last Error Snippet)

```text
timestamp=2026-09-21T16:30:39.165Z level=WARN run=1e4294ca message="failed to add snapshot files" exitCode=128 stderr="error: 'tests/fixtures/proctor-es-hit-l9DEWO/' does not have a commit checked out\nfatal: adding files failed\n"
timestamp=2026-09-21T16:44:10.471Z level=ERROR run=1e4294ca message="Failed to fetch models.dev" cause=Cause([Fail(TimeoutError)])
timestamp=2026-09-21T16:59:00.502Z level=WARN run=1e4294ca message="failed to add snapshot files" exitCode=128 stderr="warning: could not open directory 'tests/fixtures/proctor-es-hit-m1AzzX/': No such file or directory\nfatal: pathspec ':(top,literal)tests/fixtures/proctor-es-hit-m1AzzX/' did not match any files\n"
timestamp=2026-09-21T17:00:13.138Z level=WARN run=1e4294ca message="failed to add snapshot files" exitCode=128 stderr="warning: could not open directory 'tests/fixtures/proctor-es-hit-iFR4GS/': No such file or directory\nfatal: pathspec ':(top,literal)tests/fixtures/proctor-es-hit-iFR4GS/' did not match any files\n"
timestamp=2026-09-21T17:00:13.598Z level=WARN run=1e4294ca message="failed to add snapshot files" exitCode=128 stderr="warning: could not open directory 'tests/fixtures/proctor-es-both-1qx1Yx/': No such file or directory\nfatal: pathspec ':(top,literal)tests/fixtures/proctor-es-both-1qx1Yx/' did not match any files\n"
timestamp=2026-09-21T17:08:40.037Z level=WARN run=1e4294ca message="failed to add snapshot files" exitCode=128 stderr="warning: could not open directory 'tests/fixtures/proctor-es-miss-JUYqxD/': No such file or directory\nfatal: pathspec ':(top,literal)tests/fixtures/proctor-es-miss-JUYqxD/' did not match any files\n"
timestamp=2026-09-21T17:08:41.129Z level=WARN run=1e4294ca message="failed to add snapshot files" exitCode=128 stderr="warning: could not open directory 'tests/fixtures/proctor-es-both-OvpaL6/': No such file or directory\nfatal: pathspec ':(top,literal)tests/fixtures/proctor-es-both-OvpaL6/' did not match any files\n"
timestamp=2026-09-21T17:11:04.570Z level=WARN run=1e4294ca message="failed to add snapshot files" exitCode=128 stderr="warning: could not open directory 'tests/fixtures/proctor-es-pending-E2oQEH/': No such file or directory\nfatal: pathspec ':(top,literal)tests/fixtures/proctor-es-pending-E2oQEH/' did not match any files\n"
timestamp=2026-09-21T17:11:04.945Z level=WARN run=1e4294ca message="failed to add snapshot files" exitCode=128 stderr="warning: could not open directory 'tests/fixtures/proctor-es-both-wtpHoq/': No such file or directory\nfatal: pathspec ':(top,literal)tests/fixtures/proctor-es-both-wtpHoq/' did not match any files\n"
timestamp=2026-09-21T17:57:52.314Z level=ERROR run=5fd89016 message=failed ref=err_b14f3d75 error="Managed chat admission failed: IntentRejected (InvalidExplicitAgent \"build\")" cause="Error: Managed chat admission failed: IntentRejected (InvalidExplicitAgent \"build\")\n    at Plugin.trigger (/$bunfs/root/chunk-ew1rm7q3.js:1142:8941)\n    at Plugin.trigger (definition) (/$bunfs/root/chunk-1x5k94j8.js:439:29840)\n    at SessionPrompt.createUserMessage (/$bunfs/root/chunk-ew1rm7q3.js:1142:9959)\n    at SessionPrompt.createUserMessage (definition) (/$bunfs/root/chunk-ew1rm7q3.js:1142:1826)\n    at SessionPrompt.prompt (/$bunfs/root/chunk-4srzrzzf.js:4:13297)\n    at SessionPrompt.prompt (definition) (/$bunfs/root/chunk-ew1rm7q3.js:1142:9844)\n    at SessionHttpApi.prompt (/$bunfs/root/chunk-4srzrzzf.js:2:84434)\n    at SessionHttpApi.prompt (definition) (/$bunfs/root/chunk-4srzrzzf.js:4:13210)"
timestamp=2026-09-21T18:34:22.967Z level=WARN run=1e4294ca message="failed to add snapshot files" exitCode=128 stderr="error: 'tests/fixtures/proctor-es-miss-SGDFBh/' does not have a commit checked out\nfatal: adding files failed\n"
timestamp=2026-09-21T18:34:23.334Z level=WARN run=1e4294ca message="failed to add snapshot files" exitCode=128 stderr="error: 'tests/fixtures/proctor-es-hit-YyR7zD/' does not have a commit checked out\nfatal: adding files failed\n"
timestamp=2026-09-21T18:34:24.093Z level=WARN run=1e4294ca message="failed to add snapshot files" exitCode=128 stderr="warning: could not open directory 'tests/fixtures/proctor-es-pending-dBX3l3/': No such file or directory\nfatal: pathspec ':(top,literal)tests/fixtures/proctor-es-pending-dBX3l3/' did not match any files\n"
timestamp=2026-09-21T18:34:24.674Z level=WARN run=1e4294ca message="failed to add snapshot files" exitCode=128 stderr="error: 'tests/fixtures/proctor-es-both-zmFOUJ/' does not have a commit checked out\nfatal: adding files failed\n"
timestamp=2026-09-21T18:39:38.189Z level=INFO run=1e4294ca message=evaluated permission=grep pattern=InvalidExplicitAgent action.permission=grep action.action=allow action.pattern=*
timestamp=2026-09-21T18:39:58.436Z level=INFO run=1e4294ca message=evaluated permission=grep pattern="admission|IntentRejected|Managed chat|managedAgent|managed_agent|agentAdmission" action.permission=grep action.action=allow action.pattern=*
timestamp=2026-09-21T18:40:47.457Z level=INFO run=1e4294ca message=evaluated permission=grep pattern="Managed chat admission|IntentRejected|InvalidExplicitAgent|admission failed" action.permission=grep action.action=allow action.pattern=*
timestamp=2026-09-21T18:41:01.607Z level=INFO run=1e4294ca message=evaluated permission=grep pattern=InvalidExplicitAgent action.permission=grep action.action=allow action.pattern=*
timestamp=2026-09-21T18:56:25.586Z level=WARN run=1e4294ca message="failed to add snapshot files" exitCode=128 stderr="error: 'tests/fixtures/proctor-es-miss-akRRWK/' does not have a commit checked out\nfatal: adding files failed\n"
timestamp=2026-09-21T18:56:27.130Z level=WARN run=1e4294ca message="failed to add snapshot files" exitCode=128 stderr="error: 'tests/fixtures/proctor-es-both-xglQui/' does not have a commit checked out\nfatal: adding files failed\n"
```

---

## 2. 万象术组件状态快照

| 检查项                           | 检查结果                                                                   | 关联快照文件           |
| :------------------------------- | :------------------------------------------------------------------------- | :--------------------- |
| **模型调度器 (wanxiangshu.mjs)** | 语法正确 (Syntax OK)                                                       | `wanxiangshu.mjs`      |
| **持久化事件账本 (EventStore)**  | 已捕获最新账本 (`57ed55f5d8e24a7f9f69f34f2e338b39.ndjson`，共 4240 条事件) | `latest-events.ndjson` |
| **OpenCode 运行时流水**          | 已截取最新 300 行调用栈                                                    | `opencode-recent.log`  |
| **OpenCode 配置通道**            | 已脱敏固化当前 Provider 与 Agent 映射                                      | `opencode-config.json` |

---

## 3. 本次事故目录清单

```text
incident-20260922-091515-Error/
├── summary.md            # 本事故总览（优先阅读）
├── metadata.json         # 环境与 Git 机器元数据
├── opencode-recent.log   # 崩溃前夕的 OpenCode 实时流水
├── latest-events.ndjson  # 崩溃前万象术写入的内核状态机事件
├── wanxiangshu.mjs       # 当时的调度文件快照
└── opencode-config.json  # 当时的模型凭据配置快照
```
