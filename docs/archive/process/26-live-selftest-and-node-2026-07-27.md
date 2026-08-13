# 自测收口（2026-07-27）

| 字段              | 值                                             |
| :---------------- | :--------------------------------------------- |
| live 录制         | **PASS**（`PROCTOR_RECORD_CASSETTE` + hosted） |
| live journal → L3 | **PASS**（`DEMO-A-L3-LIVE-01`）                |
| Node              | 见下文                                         |

---

## 1. live 自测与调整

### 失败→修复

| 现象                      | 原因                                                                      | 调整                                                                  |
| ------------------------- | ------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| 无 `.wanxiangshu.ndjson`  | `Hosts/OpenCode/Plugin.js` 多导出被 OpenCode 当多工厂；依赖缺 `smol-toml` | `npm install`；单工厂入口 `papers/adapters/opencode-plugin-entry.mjs` |
| 录制有 journal 但试题红   | 封装只在全绿路径                                                          | 失败路径也 `trySealRecordedCassette`                                  |
| 挂旧 `Opencode/Plugin.js` | rebuild 后 fable 5.2 断裂                                                 | room 改单工厂入口；fable 5.2→5.6 符号链接                             |

### 验收命令（已绿）

```bash
SUT_ROOT=../wanxiangshu npm run proctor -- run --axis B --paperset hosted-smoke \
  --project ../wanxiangshu/papers

PROCTOR_RECORD_CASSETTE=live-hosted-record-v3 SUT_ROOT=../wanxiangshu \
  npm run proctor -- run --axis B --paperset hosted-smoke \
  --project ../wanxiangshu/papers

npm run proctor -- run --axis A --paperset smoke-A-L3 --project examples/demo-project
# 含 DEMO-A-L3-LIVE-01
```

---

## 2. Node 版本（答复「要升 22.22 吗」）

**目标不是死钉 22.22，而是满足 promptfoo engines：`^20.20.0 \|\| >=22.22.0`。**

| 本机路径                 | 版本        | 是否满足     |
| ------------------------ | ----------- | ------------ |
| `/opt/homebrew/bin/node` | **22.16.0** | ❌           |
| `/usr/local/bin/node`    | **24.18.0** | ✅（≥22.22） |

本仓已按用户指示使用 **24.18**：

- `.node-version` = `24.18.0`（fnm/nvm/asdf 等）
- 会话内 `PATH="/usr/local/bin:$PATH"`
- `npm run verify`、ST-L1 12/12、smoke-A-L3 6/6、C 轴 echo/write 已在 24.18 下绿
- promptfoo 适配器在 24.18 走**标准** `.bin/promptfoo`（不再走 `main.js` 绕过）

引擎 `package.json` engines：`>=22.22.0`；不达标 Node 仍保留 main.js 回退。

---

## 3. 剩余待办状态

| 项                 | 状态                                                                            |
| ------------------ | ------------------------------------------------------------------------------- |
| 完整 Plugin 假宿主 | **不做**：FakeHost 无 MCP/真 ctx；以 **hosted + 单工厂入口** 为真 Plugin 验收面 |
| Node 24.18         | **已切**（本仓会话 + `.node-version`）                                          |
| 密钥轮换           | 仍请你在平台操作（聊天曾暴露）                                                  |
| npm 公开发布       | 未做（需 registry 账号）                                                        |
| ST 真 git e2e      | ST-06/09/12/14/16 仍需真宿主/git，未 L1 化                                      |

---

## 宣称边界

- ✅ live 录制 + journal L3 回放自测绿
- ✅ 本仓工作流以 Node **24.18** 验证（`.node-version`）；默认 shell PATH 若仍指向 22.16，需自行 `export PATH="/usr/local/bin:$PATH"`
- ❌ 未宣称 npm 已发布 / 假宿主跑完整 Plugin
